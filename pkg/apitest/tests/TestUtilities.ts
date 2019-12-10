import amqp from 'amqplib';
import { HttpMethod, HttpStatusCode, Paths } from 'common';
import createDebug from 'debug';
import FormData from 'form-data';
import fs from 'fs';
import fetch, { BodyInit, Headers } from 'node-fetch';

const debug = createDebug('apitest:libraries');

export const ApiBaseUrl = 'http://localhost:3000';
export const SystemUserId = '11111111-1111-1111-1111-111111111111';

// Tests need to connect to the RabbitMQ server to check queue
// status.  To do that we need to provide authorization information.
// We currently use basic auth and the default 'guest' login with
// 'guest' password.  Probably should make this more secure at some point.
const RabbitAuthHeaderValue = 'Basic Z3Vlc3Q6Z3Vlc3Q=';
const WaitRetryCount = 10;

export async function getStats() {
  return sendRequest('service/stats', SystemUserId).then(result => {
    expect(result.status).toBe(HttpStatusCode.OK);
    return result.json();
  });
}

export async function sendRequest(
  relativeUrl: string,
  userId?: string,
  method: HttpMethod = HttpMethod.Get,
  body?: BodyInit
) {
  const headers = new Headers();

  if (method !== HttpMethod.Get) {
    headers.append('Content-Type', 'application/json');
  }

  if (userId) {
    headers.append('Api-User-ID', userId);
  }

  return fetch(`${ApiBaseUrl}/${relativeUrl}`, {
    method,
    headers,
    body
  });
}

/**
 * Posts a file to the API under test.
 *
 * @param relativeUrl Site-relative URL to use in the post.
 * @param userId Unique ID of the user making the post.
 * @param body FormData object which manages the multipart/form-data.
 */
export async function postFile(
  relativeUrl: string,
  userId: string,
  body: FormData
) {
  const headers = new Headers();
  headers.append('Api-User-ID', userId);

  return fetch(`${ApiBaseUrl}/${relativeUrl}`, {
    method: HttpMethod.Post,
    headers,
    body
  });
}

/**
 * Posts a file from the local file system to a folder in a library.
 *
 * @param userId Unique ID of the user making the post.
 * @param libraryId Unique ID of the library to post to.
 * @param folderId Unique ID of the parent folder.
 * @param localPath Local path to the file to upload.
 * @param contentType Content type of the file to upload.
 */
export async function postFileToFolder(
  userId: string,
  libraryId: string,
  folderId: string,
  localPath: string,
  contentType: string
) {
  const form = new FormData();
  const buffer = fs.readFileSync(localPath);
  const filename = Paths.getLastSubpath(localPath);

  form.append('files', buffer, {
    contentType,
    filename
  });

  return postFile(
    `libraries/${libraryId}/folders/${folderId}/pictures`,
    userId,
    form
  );
}

/**
 * Sleeps for a specified duration.
 *
 * @param timeMs Number of milliseconds to sleep.
 */
export async function sleep(timeMs: number) {
  await new Promise(resolve => setTimeout(resolve, timeMs));
}

/**
 * Waits for all files to be processed before returning.
 */
export async function waitForProcessingComplete() {
  let retry = 0;

  while (retry < WaitRetryCount) {
    // If there are no files being processed we are done.
    const count = await getProcessingCount();
    if (count === 0) {
      return;
    }

    // Check again in a bit.
    retry++;
    await sleep(1000);
  }

  expect(retry).toBeLessThan(WaitRetryCount);
}

/**
 * Gets the number of files that are currently being processed.
 */
export async function getProcessingCount() {
  return getStats().then(stats => {
    debug(`Processing count: ${stats.processingCount}`);
    return stats.processingCount;
  });
}

/**
 * Waits for the asynchronous queue to drain.
 */
export async function waitForQueueDrain() {
  let retry = 0;

  while (retry < WaitRetryCount) {
    // If the queue length is 0 we're done.
    const len = await getQueueLen();
    if (len === 0) {
      return;
    }

    // Check again in a bit.
    retry++;
    await sleep(1000);
  }

  expect(retry).toBeLessThan(WaitRetryCount);
}

/**
 * Gets the number of messages in the async queue.
 */
export async function getQueueLen() {
  const headers = new Headers();
  headers.append('Authorization', RabbitAuthHeaderValue);

  return fetch('http://localhost:15672/api/queues', { headers }).then(
    response => {
      expect(response.status).toBe(HttpStatusCode.OK);
      return response.json().then(queues => {
        debug(`Messags in queue: ${queues[0].messages}`);
        return queues[0].messages as number;
      });
    }
  );
}
