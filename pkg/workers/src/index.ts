import amqp from 'amqplib';
import createDebug from 'debug';

const debug = createDebug('workers:workers');
let amqpConn: amqp.Connection | undefined;
let amqpChan: amqp.Channel | undefined;

const RabbitUrl = 'amqp://localhost';
const JobsChannelName = 'reimas_jobs';

/**
 * Connects to the RabbitMQ server.  If successful then starts
 * the worker which processes incoming messages.
 */
function connect() {
  debug(`Connection to RabbitMQ server at ${RabbitUrl}`);
  amqp
    .connect(`${RabbitUrl}?heartbeat=60`)
    .then(conn => {
      conn.on('error', err => {
        if (err.message !== 'Connection closing') {
          debug('Error communicating with RabbitMQ: ' + err.message);
        }
      });

      conn.on('close', () => {
        debug('RabbitMQ connection closed.  Reconnecting...');
        return setTimeout(connect, 1000);
      });

      debug('RabbitMQ connection established.');
      amqpConn = conn;
      startWorker();
    })
    .catch(err => {
      debug('Unexpected RabbitMQ error: ' + err.message);
      return setTimeout(connect, 1000);
    });
}

/**
 * Creates the RabbitMQ channel and initializes the queue consumer.
 */
function startWorker() {
  amqpConn!
    .createChannel()
    .then(ch => {
      amqpChan = ch;

      ch.on('error', err => {
        debug('RabbitMQ channel error: ' + err.message);
      });

      ch.on('close', () => {
        debug('RabbitMQ channel closed.');
      });

      ch.prefetch(10);

      return ch.assertQueue(JobsChannelName, { durable: true }).then(ok => {
        return ch
          .consume(JobsChannelName, handleMessageReceived, { noAck: false })
          .then(() => {
            debug('Worker initialized successfully.');
          });
      });
    })
    .catch(errorHandler);
}

/**
 * Handles the receipt of an incoming message from the queue.
 *
 * @param msg Message to process.
 */
function handleMessageReceived(msg: amqp.ConsumeMessage | null) {
  if (msg) {
    processMessage(msg, (ok: boolean) => {
      try {
        // Channel may have gone down while the message was
        // being processed.
        if (!amqpChan) {
          return;
        }

        if (ok) {
          amqpChan.ack(msg);
        } else {
          amqpChan.reject(msg, true);
        }
      } catch (err) {
        errorHandler(err);
      }
    });
  }
}

/**
 * Processes a message received from the queue.
 *
 * @param msg The message to process.
 * @param callback Invoked when processing is complete.
 */
function processMessage(
  msg: amqp.ConsumeMessage,
  callback: (ok: boolean) => void
) {
  debug('Message processed ' + msg.content.toString());
  callback(true);
}

/**
 * Handles errors received from AMQP.
 *
 * @param err Error received from AMQP.
 */
function errorHandler(err: Error) {
  debug('RabbitMQ error: ' + err);

  if (amqpChan) {
    amqpChan.close();
    amqpChan = undefined;
  }

  if (amqpConn) {
    amqpConn.close();
    amqpConn = undefined;
  }

  return true;
}

connect();