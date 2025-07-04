const winston = require('winston');
const {updateMissingStreams, updatePowerCurve} = require('./processing/automatedChecks');
const {logMessage} = require('./utility/general');
const { Worker } = require("worker_threads");
const path = require("path");

let worker;
let shuttingDown = false;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: './logs/ocdapi.log' }),
  ],
});

// Stream function for Fastify
const stream = {
  write: (message) => logger.info(message.trim()),
};

const fastify = require('fastify')(
  {
    logger: {
      level: 'warn',
      disableRequestLogging: true,
      stream,
    },
  }
);
const dbConnector = require('./db/db');

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Register CORS plugin
fastify.register(require('@fastify/cors'), {
  logger: {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  },
  origin: (origin, cb) => {
    const allowedOrigins = ['http://localhost:5173'];  // Update this to your frontend origin
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      cb(null, true);
      return;
    }
    cb(new Error('Not allowed'), false);
  },
  credentials: true // Allow credentials (optional, if required)
});

// Register JWT plugin
const { fastifyJwt } = require('@fastify/jwt');
const { log } = require('console');
fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET
});

// Register the database connector plugin
fastify.register(dbConnector);

// JWT authentication hook
fastify.decorate("authenticate", async function(request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
});

// Register routes from the routes directory
fastify.register(require('./routes/check'));
fastify.register(require('./routes/cluster'));
fastify.register(require('./routes/dashboard'));
fastify.register(require('./routes/ocds'));
fastify.register(require('./routes/riders'));
fastify.register(require('./routes/rides'));
fastify.register(require('./routes/reference'));
fastify.register(require('./routes/segments'));
fastify.register(require('./routes/strava'));
fastify.register(require('./routes/user'));
fastify.register(require('./routes/gear'));

// Expose a route to generate JWT token (for testing purposes)
fastify.post('/token', (request, reply) => {
  const { user } = request.body;
  const token = fastify.jwt.sign({ user });
  reply.send({ token });
});

// Start the worker thread
function startWorker() {
  worker = new Worker(path.resolve(__dirname, "worker//worker.js"), {
    workerData: {
      dbConfig: {
        user: process.env.OCD_DB_USER,
        host:  process.env.OCD_DB_HOST,
        database: process.env.OCD_DB_NAME,
        password: process.env.OCD_DB_PASSWORD,
        port: process.env.OCD_DB_PORT,
      },
    },
  });

  worker.on("message", (msg) => {
    console.log("Message from worker:", msg);
  });

  worker.on("error", (err) => {
    console.error("Worker error:", err);
  });

  worker.on("exit", (code) => {
    console.log(`Worker exited with code: ${code}`);
    if (!shuttingDown) {
      console.log("Restarting worker...");
      startWorker(); // Restart worker if it exits unexpectedly
    }
  });

  console.log("Worker started.");
}

// Graceful workder shutdown logic
async function shutdownWorker() {
  shuttingDown = true;

  if (worker) {
    console.log("Notifying worker to shut down...");
    worker.postMessage({ type: "shutdown" }); // Notify worker to shut down

    // Wait for the worker to exit, with a grace period
    const shutdownTimeout = new Promise((resolve) =>
      setTimeout(() => {
        console.log("Grace period expired, terminating worker.");
        worker.terminate().then(resolve);
      }, 5000) // 5-second grace period
    );

    await Promise.race([
      new Promise((resolve) =>
        worker.once("exit", () => {
          console.log("Worker exited gracefully.");
          resolve();
        })
      ),
      shutdownTimeout,
    ]);
  }

  console.log("Worker shutdown complete.");
}

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server is running on http://localhost:3000');
    logger.info('Server is running on http://localhost:3000');
    startWorker();

  } catch (err) {
    const message = `Server is not running: ${JSON.stringify(err)}`;
    fastify.log.error(message);
    logger.error(message);
    process.exit(1);
  }
};

let taskIntervals = [];
const interval1InMinutes = 21;
const interval1InMilliseconds = interval1InMinutes * 60 * 1000

const interval2InMinutes = 61;
const interval2InMilliseconds = interval2InMinutes * 60 * 1000

fastify.ready(() => {
  taskIntervals.push( setInterval(() => {
    runPeriodicTask1();
  }, interval1InMilliseconds));

  taskIntervals.push( setInterval(() => {
    runPeriodicTask2();
  }, interval2InMilliseconds));
});

fastify.addHook('onClose', (instance, done) => {
  if (taskIntervals.length > 0) {
    taskIntervals.forEach(interval => clearInterval(interval));
    logger.info('Periodic task(s) stopped.');
    console.log("Periodic task(s) stopped.");
  }
  done();
});

async function runPeriodicTask1() {
  try {
    await updateMissingStreams(fastify);
  } catch (error) {
    logger.info(`Error running updateMissingStreams: ${error.message}`);
    console.error("Error running updateMissingStreams:", error);
  }
}

async function runPeriodicTask2() {
  try {
    await updatePowerCurve(fastify);
  } catch (error) {
    logger.info(`Error running updatePowerCurve: ${error.message}`);
    console.error("Error running updatePowerCurve:", error);
  }
}

// Handle process termination signals
process.on("SIGINT", async () => {
  logger.info("SIGINT received. Shutting down...");
  console.log("SIGINT received. Shutting down...");
  await shutdownWorker();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received. Shutting down...");
  await shutdownWorker();
  process.exit(0);
});

start();
