import {
  IExportJobAdd,
  ExportJobStatus,
  IFile,
  IFolder,
  ILibrary,
  ILibraryAdd,
  Role
} from '@picstrata/client';
import {
  HttpMethod,
  HttpStatusCode,
  Paths,
  PictureMimeType,
  VideoMimeType
} from 'common';
import createDebug from 'debug';
import { v1 as createGuid } from 'uuid';
import {
  ApiBaseUrl,
  createFolder,
  copyFile,
  getFilesInFolder,
  getStats,
  logTestStart,
  postFileToFolder,
  sendRequest,
  sleep,
  waitForProcessingComplete,
  waitForQueueDrain
} from './TestUtilities';

const debug = createDebug('apitest:libraries');

/**
 * Test data
 */
const OwnerUserId = createGuid();
const ContributorUserId = createGuid();
const ReaderUserId = createGuid();
const NonMemberUserId = createGuid();

const NewLibrary: ILibraryAdd = {
  name: 'Test Library',
  timeZone: 'America/Los_Angeles',
  description: 'Test Library Description'
};

const MetadataEx = {
  Make: 'Apple',
  Model: 'iPhone 11',
  DateTimeOriginal: '2015:07:04 09:00:00.00',
  GPSLatitude: 28.52343,
  GPSLongitude: -80.68181,
  GPSAltitude: 10000
};

const TestPictures = [
  {
    path: '../../test/samples/Aurora.jpg',
    contentType: PictureMimeType.Jpg,
    height: 3840,
    width: 5760,
    byteLength: 1574829
  },
  {
    path: '../../test/samples/Marbles.GIF',
    contentType: PictureMimeType.Gif,
    height: 1001,
    width: 1419,
    byteLength: 770388
  },
  {
    path: '../../test/samples/Marina.png',
    contentType: PictureMimeType.Jpg,
    height: 1521,
    width: 2028,
    byteLength: 4515013,
    metadataEx: JSON.stringify(MetadataEx)
  },
  {
    path: '../../test/samples/Space.jpg',
    contentType: PictureMimeType.Jpg,
    height: 450,
    width: 600,
    byteLength: 31780
  },
  {
    path: '../../test/samples/Abbey.jpg',
    contentType: PictureMimeType.Jpg,
    height: 1512,
    width: 2016,
    byteLength: 889411,
    // This file is rotated on upload.
    processedByteLength: 933484,
    cameraMake: 'Apple',
    cameraModel: 'iPhone XR'
  },
  {
    path: '../../test/samples/E. coli.tiff',
    contentType: PictureMimeType.Tiff,
    height: 512,
    width: 640,
    byteLength: 258948
  }
];

const TestVideos = [
  {
    path: '../../test/samples/big-buck-bunny.mp4',
    contentType: VideoMimeType.MP4,
    height: 176,
    width: 320,
    byteLength: 788493
  },
  {
    path: '../../test/samples/jellyfish-25-mbps-hd-hevc.mp4',
    contentType: VideoMimeType.MP4,
    height: 1080,
    width: 1920,
    byteLength: 32822684
  },
  {
    path: '../../test/samples/small.avi',
    contentType: VideoMimeType.AVI,
    height: 320,
    width: 560,
    byteLength: 410162
  },
  {
    path: '../../test/samples/Puffins.mov',
    contentType: VideoMimeType.MOV,
    height: 320,
    width: 568,
    byteLength: 311253
  }
];

describe('File Tests', () => {
  let testLibraryId: string;
  let allPicturesFolderId: string;
  const fileIds: string[] = [];

  beforeAll(() => {
    jest.setTimeout(20000);
    debug(`Testing file routes on API server at ${ApiBaseUrl}`);
  });

  beforeEach(async () => {
    await logTestStart();
  });

  test('Verify initial state', async () => {
    return getStats().then(stats => {
      expect(stats.libraryCount).toBe(0);
      expect(stats.folderCount).toBe(0);
      expect(stats.fileCount).toBe(0);
      expect(stats.objectUserCount).toBe(0);
    });
  });

  test('Verify addition of files to library', async () => {
    // Create a new library.
    await sendRequest(
      'libraries',
      OwnerUserId,
      HttpMethod.Post,
      JSON.stringify(NewLibrary)
    ).then(result => {
      expect(result.status).toBe(HttpStatusCode.OK);
      return result.json().then((library: ILibrary) => {
        testLibraryId = library.libraryId;
        expect(library.name).toBe(NewLibrary.name);
        expect(library.description).toBe(NewLibrary.description);
        expect(library.userRole).toBe(Role.Owner);
      });
    });

    // Grab the All Pictures folder ID.
    await sendRequest(
      `libraries/${testLibraryId}/folders?parent=`,
      OwnerUserId
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.OK);
      return response.json().then((folders: IFolder[]) => {
        expect(folders).toHaveLength(1);
        allPicturesFolderId = folders[0].folderId;
        expect(folders[0].userRole).toBe(Role.Owner);
      });
    });

    // Add a contributor to that folder.
    await sendRequest(
      `libraries/${testLibraryId}/folders/${allPicturesFolderId}/users`,
      OwnerUserId,
      HttpMethod.Post,
      JSON.stringify({
        userId: ContributorUserId,
        role: Role.Contributor
      })
    ).then(result => {
      expect(result.status).toBe(HttpStatusCode.OK);
    });

    // Add a reader to that folder.
    await sendRequest(
      `libraries/${testLibraryId}/folders/${allPicturesFolderId}/users`,
      OwnerUserId,
      HttpMethod.Post,
      JSON.stringify({
        userId: ReaderUserId,
        role: Role.Reader
      })
    ).then(result => {
      expect(result.status).toBe(HttpStatusCode.OK);
    });

    // Upload some files.
    for (const picture of TestPictures) {
      await postFileToFolder(
        OwnerUserId,
        testLibraryId,
        allPicturesFolderId,
        picture.path,
        picture.contentType,
        picture.metadataEx
      ).then((file: IFile) => {
        expect(file.mimeType).toBe(picture.contentType);
        expect(file.height).toBe(picture.height);
        expect(file.width).toBe(picture.width);
        fileIds.push(file.fileId);
      });
    }

    // Verify that the owner can get the list of files back along with their metadata.
    await sendRequest(
      `libraries/${testLibraryId}/folders/${allPicturesFolderId}/files`,
      OwnerUserId
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.OK);
      return response.json().then((files: IFile[]) => {
        expect(files).toHaveLength(TestPictures.length);
      });
    });

    // Verify that the owner can download the metdata as well as the content of each file.
    for (let i = 0; i < fileIds.length; i++) {
      const fileId = fileIds[i];

      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}`,
        OwnerUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.OK);
        return response.json().then((file: IFile) => {
          expect(file.fileId).toBe(fileId);
          expect(file.name).toBe(Paths.getLastSubpath(TestPictures[i].path));
          expect(file.width).toBe(TestPictures[i].width);
          expect(file.height).toBe(TestPictures[i].height);
        });
      });

      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}/contents`,
        OwnerUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.OK);
        return response.blob().then((blob: any) => {
          expect(
            blob.size === TestPictures[i].processedByteLength ||
              blob.size === TestPictures[i].byteLength
          ).toBe(true);
        });
      });
    }
  });

  test('Verify access to file information', async () => {
    // Verify that contributors can see the list of files.
    await sendRequest(
      `libraries/${testLibraryId}/folders/${allPicturesFolderId}/files`,
      ContributorUserId
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.OK);
    });

    // Verify that readers can see the list of files.
    await sendRequest(
      `libraries/${testLibraryId}/folders/${allPicturesFolderId}/files`,
      ReaderUserId
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.OK);
    });

    // Verify that non-members cannot see the list of files.
    await sendRequest(
      `libraries/${testLibraryId}/folders/${allPicturesFolderId}/files`,
      NonMemberUserId
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.NOT_FOUND);
    });

    for (const fileId of fileIds) {
      // Contributors should be able to read the file metadata.
      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}`,
        ContributorUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.OK);
      });

      // Readers should be able to read the file metadata.
      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}`,
        ReaderUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.OK);
      });

      // Non-members should not be able to read the file metadata.
      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}`,
        NonMemberUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.NOT_FOUND);
      });

      // Contributors should be able to get the file contents.
      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}/contents`,
        ContributorUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.OK);
      });

      // Readers should be able to see the file contents.
      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}/contents`,
        ReaderUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.OK);
      });

      // Non-members should not be able to see the file contents.
      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}/contents`,
        NonMemberUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.NOT_FOUND);
      });
    }
  });

  test('Verify asynchronous job execution', async () => {
    // Wait for all file processing to complete
    await waitForQueueDrain();
    await waitForProcessingComplete();

    // Readers should be able to fetch the thumbnails that
    // were generated asynchronously
    for (let i = 0; i < fileIds.length; i++) {
      const fileId = fileIds[i];
      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}/thumbnails/sm`,
        ReaderUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.OK);
        return response.blob().then((blob: any) => {
          expect(blob.size).toBeLessThan(TestPictures[i].byteLength);
        });
      });
      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}/thumbnails/md`,
        ReaderUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.OK);
      });
      await sendRequest(
        `libraries/${testLibraryId}/files/${fileId}/thumbnails/lg`,
        ReaderUserId
      ).then(response => {
        expect(response.status).toBe(HttpStatusCode.OK);
      });
    }

    // Files should be rotated if necessary and GPS coords should be imported.
    // Also camera make and model should be imported.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[4]}`,
      ReaderUserId
    ).then(response => {
      response.json().then((file: IFile) => {
        expect(file.width).toBe(TestPictures[4].height);
        expect(file.height).toBe(TestPictures[4].width);
        expect(file.cameraMake).toBe(TestPictures[4].cameraMake);
        expect(file.cameraModel).toBe(TestPictures[4].cameraModel);
        expect(file.fileSize).toBe(TestPictures[4].processedByteLength);
        expect(file.latitude).toBe('56.3349722222');
        expect(file.longitude).toBe('-6.3922305556');
        expect(file.altitude).toBe('19.19868277');
        expect(file.takenOn).toBe('2019-06-28T12:43:29.000Z');
      });
    });

    // Metadata extracted from files should also be available.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[0]}`,
      ReaderUserId
    ).then(response => {
      response.json().then((file: IFile) => {
        expect(file.takenOn).toBe('2011-10-10T04:22:31.000Z');
        expect(file.title).toBe('Aurora Borealis');
        expect(file.comments).toBe(
          'A photo of the Aurora Borealis over an ice field.'
        );
        expect(file.tags).toHaveLength(3);
        expect(file.tags[0]).toBe('Atmosphere');
        expect(file.tags[1]).toBe('Nature');
        expect(file.tags[2]).toBe('Night');
      });
    });

    // Metadata provided outside the file should be processed properly.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[2]}`,
      ReaderUserId
    ).then(response => {
      response.json().then((file: IFile) => {
        expect(file.width).toBe(TestPictures[2].width);
        expect(file.height).toBe(TestPictures[2].height);
        expect(file.cameraMake).toBe(MetadataEx.Make);
        expect(file.cameraModel).toBe(MetadataEx.Model);
        expect(file.latitude).toBe(MetadataEx.GPSLatitude.toString());
        expect(file.longitude).toBe(MetadataEx.GPSLongitude.toString());
        expect(file.altitude).toBe(MetadataEx.GPSAltitude.toString());
        expect(file.takenOn).toBe('2015-07-04T13:00:00.000Z');
      });
    });

    // Tiff files should be converted to JPEG.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[5]}`,
      ReaderUserId
    ).then(response => {
      response.json().then((file: IFile) => {
        expect(file.fileSizeCnv).toBeGreaterThan(0);
      });
    });

    // Verify folder calcs.
    await sendRequest(
      `libraries/${testLibraryId}/folders/${allPicturesFolderId}`,
      ReaderUserId
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.OK);
      return response.json().then((folder: IFolder) => {
        expect(folder.fileCount).toBe(TestPictures.length);
        expect(folder.fileSize).toBe(
          TestPictures[0].byteLength +
            TestPictures[1].byteLength +
            TestPictures[2].byteLength +
            TestPictures[3].byteLength +
            TestPictures[4].processedByteLength! +
            TestPictures[5].byteLength
        );
        expect(folder.fileSizeSm).toBeGreaterThan(0);
        expect(folder.fileSizeMd).toBeGreaterThan(folder.fileSizeSm);
        expect(folder.fileSizeLg).toBeGreaterThan(folder.fileSizeMd);
      });
    });
  });

  test('Verify ability to update files', async () => {
    // Verify that owners can update files.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[0]}`,
      OwnerUserId,
      HttpMethod.Patch,
      JSON.stringify({
        name: 'Aurora1.jpg',
        rating: 3
      })
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.OK);
      return response.json().then((file: IFile) => {
        expect(file.name).toBe('Aurora1.jpg');
        expect(file.rating).toBe(3);
      });
    });

    // Verify that contributors can update files.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[0]}`,
      ContributorUserId,
      HttpMethod.Patch,
      JSON.stringify({
        name: 'Aurora.jpg'
      })
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.OK);
      return response.json().then((file: IFile) => {
        expect(file.name).toBe('Aurora.jpg');
      });
    });

    // Verify that readers cannot update files
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[0]}`,
      ReaderUserId,
      HttpMethod.Patch,
      JSON.stringify({
        name: 'Aurora1.jpg'
      })
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.UNAUTHORIZED);
    });

    // Verify that non-participants cannot see files to update them
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[0]}`,
      NonMemberUserId,
      HttpMethod.Patch,
      JSON.stringify({
        name: 'Aurora1.jpg'
      })
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.NOT_FOUND);
    });
  });

  test('Verify ability to delete files', async () => {
    // Verify that the owner can delete a file.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[1]}`,
      OwnerUserId,
      HttpMethod.Delete
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.OK);
      return response.json().then((file: IFile) => {
        expect(file.fileId).toBe(fileIds[1]);
      });
    });

    // Verify that a contributor can delete a file.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[2]}`,
      ContributorUserId,
      HttpMethod.Delete
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.OK);
      return response.json().then((file: IFile) => {
        expect(file.fileId).toBe(fileIds[2]);
      });
    });

    // Verify that a reader cannot delete a file.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[3]}`,
      ReaderUserId,
      HttpMethod.Delete
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.UNAUTHORIZED);
    });

    // Verify that non-participants don't even see the files.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[0]}`,
      NonMemberUserId,
      HttpMethod.Delete
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.NOT_FOUND);
    });
  });

  test('Verify addition of videos to library', async () => {
    // Create VideoSubFolder
    const videoFolder = await createFolder(
      OwnerUserId,
      testLibraryId,
      allPicturesFolderId,
      'VideoSubFolder'
    );

    // Upload some videos.
    for (const video of TestVideos) {
      await postFileToFolder(
        OwnerUserId,
        testLibraryId,
        videoFolder.folderId,
        video.path,
        video.contentType
      ).then((file: IFile) => {
        expect(file.mimeType).toBe(video.contentType);
      });
    }

    // Let asynchronous processing complete.
    await waitForQueueDrain();
    await waitForProcessingComplete();

    // Get the list of files back along with their metadata.
    const files = await getFilesInFolder(
      OwnerUserId,
      testLibraryId,
      videoFolder.folderId
    );
    expect(files).toHaveLength(TestVideos.length);
    for (const videoFile of files) {
      expect(videoFile.width).toBeGreaterThan(0);
      expect(videoFile.height).toBeGreaterThan(0);
    }
  });

  test('Verify name conflict resolution', async () => {
    const picture = TestPictures[1];
    const name = Paths.getLastSubpath(picture.path);
    let secondFileId = '';

    // Upload a file and verify that it gets the expected name.
    await postFileToFolder(
      OwnerUserId,
      testLibraryId,
      allPicturesFolderId,
      picture.path,
      picture.contentType
    ).then((file: IFile) => {
      fileIds[1] = file.fileId;
      expect(file.name).toBe(name);
    });

    // Upload the same file again and verify that a new name was generated.
    await postFileToFolder(
      OwnerUserId,
      testLibraryId,
      allPicturesFolderId,
      picture.path,
      picture.contentType
    ).then((file: IFile) => {
      secondFileId = file.fileId;
      expect(file.name).not.toBe(Paths.getLastSubpath(picture.path));
    });

    // Try to rename the second file to overwrite the first.
    await sendRequest(
      `libraries/${testLibraryId}/files/${secondFileId}`,
      OwnerUserId,
      HttpMethod.Patch,
      JSON.stringify({ name })
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.CONFLICT);
    });
  });

  test('Verify renaming of files to different extension error handling', async () => {
    // Verify that files cannot be renamed to bogus extensions.
    await sendRequest(
      `libraries/${testLibraryId}/files/${fileIds[0]}`,
      OwnerUserId,
      HttpMethod.Patch,
      JSON.stringify({ name: 'Aurora.txt' })
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.BAD_REQUEST);
    });
  });

  test('Verify that files can be copied to other folders', async () => {
    const subFolder1 = await createFolder(
      OwnerUserId,
      testLibraryId,
      allPicturesFolderId,
      'SubFolder1'
    );
    const subFolder2 = await createFolder(
      OwnerUserId,
      testLibraryId,
      allPicturesFolderId,
      'SubFolder2'
    );
    const file = await postFileToFolder(
      OwnerUserId,
      testLibraryId,
      subFolder1.folderId,
      TestPictures[0].path,
      TestPictures[0].contentType,
      TestPictures[0].metadataEx
    );

    // Copy the file from SubFolder1 to SubFolder2.
    const copy1 = await copyFile(
      OwnerUserId,
      testLibraryId,
      file.fileId,
      subFolder2.folderId
    );
    expect(copy1.name).toBe(file.name);

    // Make sure the file shows up in SubFolder2
    const subFolder2Files = await getFilesInFolder(
      OwnerUserId,
      testLibraryId,
      subFolder2.folderId
    );
    expect(subFolder2Files.length).toBe(1);

    await waitForProcessingComplete();

    const subFolder3 = await createFolder(
      OwnerUserId,
      testLibraryId,
      subFolder2.folderId,
      'SubFolder3'
    );

    // Copy the file from SubFolder1 to SubFolder3.
    const copy2 = await copyFile(
      OwnerUserId,
      testLibraryId,
      file.fileId,
      subFolder3.folderId
    );
    expect(copy2.name).toBe(file.name);

    // Copy the file from SubFolder2 to Subfolder3
    const copy3 = await copyFile(
      OwnerUserId,
      testLibraryId,
      copy1.fileId,
      subFolder3.folderId
    );
    expect(copy3.name).not.toBe(file.name);
    expect(copy3.name).toContain('(2)');

    // Make sure the file shows up in SubFolder3
    const subFolder3Files = await getFilesInFolder(
      OwnerUserId,
      testLibraryId,
      subFolder3.folderId
    );
    expect(subFolder3Files.length).toBe(2);

    await waitForProcessingComplete();
  });

  test('Verify that files can be exported as a zip', async () => {
    const folder1 = await createFolder(
      OwnerUserId,
      testLibraryId,
      allPicturesFolderId,
      'Files to Export'
    );

    const folder2 = await createFolder(
      OwnerUserId,
      testLibraryId,
      allPicturesFolderId,
      'More Files to Export'
    );

    const fileIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const file = await postFileToFolder(
        OwnerUserId,
        testLibraryId,
        folder1.folderId,
        TestPictures[i].path,
        TestPictures[i].contentType,
        TestPictures[i].metadataEx
      );
      fileIds.push(file.fileId);
    }

    // Add one of the files to another folder to test
    // duplicate filename handling.
    const file = await postFileToFolder(
      OwnerUserId,
      testLibraryId,
      folder2.folderId,
      TestPictures[0].path,
      TestPictures[0].contentType,
      TestPictures[0].metadataEx
    );
    fileIds.push(file.fileId);

    // Verify that we can post the export job.
    const response = await sendRequest(
      `libraries/${testLibraryId}/exportjobs`,
      OwnerUserId,
      HttpMethod.Post,
      JSON.stringify({
        libraryId: testLibraryId,
        fileIds,
        filename: 'TextExport.zip'
      } as IExportJobAdd)
    );
    expect(response.status).toBe(HttpStatusCode.OK);

    // Verify that we  get a job ID (a GUID) back.
    const payload = await response.json();
    expect(payload.jobId).toBeDefined();
    expect(payload.jobId).toHaveLength(36);

    await waitForQueueDrain();

    await sendRequest(
      `libraries/${testLibraryId}/exportjobs/${payload.jobId}`,
      OwnerUserId
    ).then(async response => {
      expect(response.status).toBe(HttpStatusCode.OK);
      const job = await response.json();
      expect(job.status).toBe(ExportJobStatus.Success);
      expect(job.fileIds).toHaveLength(6);
    });

    await sendRequest(
      `libraries/${testLibraryId}/exports/${payload.jobId}`,
      OwnerUserId
    ).then(response => {
      expect(response.status).toBe(HttpStatusCode.OK);
      return response.blob().then((blob: any) => {
        expect(blob.size).toBeGreaterThan(10);
      });
    });
  });

  test('Verify clean up', async () => {
    // Wait for the queue to drain and all processing to complete.
    // Then wait a little longer to let jobs like the folder reacalc
    // job to complete--there isn't currently a way to see if it is
    // running.
    await waitForQueueDrain();
    await waitForProcessingComplete();
    await sleep(1000);
    debug('Deleting library...');

    await sendRequest(
      `libraries/${testLibraryId}`,
      OwnerUserId,
      HttpMethod.Delete
    ).then(result => {
      expect(result.status).toBe(HttpStatusCode.OK);
    });

    await getStats().then(stats => {
      expect(stats.libraryCount).toBe(0);
      expect(stats.folderCount).toBe(0);
      expect(stats.fileCount).toBe(0);
      expect(stats.objectUserCount).toBe(0);
    });
  });
});
