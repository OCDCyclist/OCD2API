const winston = require('winston');

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
fastify.register(require('./routes/segments'));
fastify.register(require('./routes/strava'));
fastify.register(require('./routes/user'));

// Expose a route to generate JWT token (for testing purposes)
fastify.post('/token', (request, reply) => {
  const { user } = request.body;
  const token = fastify.jwt.sign({ user });
  reply.send({ token });
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server is running on http://localhost:3000');
    logger.info('Server is running on http://localhost:3000');
  } catch (err) {
    const message = `Server is not running: ${JSON.stringify(err)}`;
    fastify.log.error(message);
    logger.error(message);
    process.exit(1);
  }
};

start();
