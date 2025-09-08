const {
  getCummulativesByYear,
  getYearAndMonth,
  getYearAndDOW,
  getMonthAndDOM,
  getStreaks_1_day,
  getStreaks_7days200,
  getMilestoness_TenK,
  getOutdoorIndoor,
  getOutdoorIndoorYearMonth,
  getRideDayFractions,
  updateCummulatives,
  updateFFFMetrics,
  updateRuns
} = require('../db/dbQueries');
const { parseBoolean } = require('../utility/general');

async function ocdRoutes(fastify, options) {
  // Define the dashboard route
  fastify.get('/ocds/cummulatives',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const years = request.query.years ? request.query.years.split(',').map(Number) : [];

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getCummulativesByYear(fastify, riderId, years);
      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);

      } catch (err) {
        console.error('Database error cummulatives:', err);
        return reply.code(500).send({ error: 'Database error cummulatives' });
      }
    }
  );

  fastify.get('/ocds/yearandmonth',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

      const id = parseInt(riderId, 10);
      if (isNaN(id)) {
        return reply.code(400).send({ error: 'Invalid or missing riderId' });
      }

      try {
        const result = await getYearAndMonth(fastify, riderId);

        if (!Array.isArray(result)) {
          return reply.code(200).send([]);
        }

        return reply.code(200).send(result);
      } catch (err) {
        console.error('Database error:', err);
        return reply.code(500).send({ error: 'Database error' });
      }
  });

  fastify.get('/ocds/yearanddow',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

      const id = parseInt(riderId, 10);
      if (isNaN(id)) {
        return reply.code(400).send({ error: 'Invalid or missing riderId' });
      }

      try {
        const result = await getYearAndDOW(fastify, riderId);

        if (!Array.isArray(result)) {
          return reply.code(200).send([]);
        }

        return reply.code(200).send(result);
      } catch (err) {
        console.error('Database error:', err);
        return reply.code(500).send({ error: 'Database error' });
      }
  });

  fastify.get('/ocds/monthanddom',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getMonthAndDOM(fastify, riderId);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);
  } catch (err) {
      console.error('Database error monthanddom:', err);
      return reply.code(500).send({ error: 'Database error monthanddom' });
    }
  });

  fastify.get('/ocds/streaks/1',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getStreaks_1_day(fastify, riderId);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);
  } catch (err) {
      console.error('Database error streaks 1 day:', err);
      return reply.code(500).send({ error: 'Database error streaks 1 day' });
    }
  });

  fastify.get('/ocds/streaks/7days200',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getStreaks_7days200(fastify, riderId);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);
  } catch (err) {
      console.error('Database error streaks 7days200:', err);
      return reply.code(500).send({ error: 'Database error streaks 7days200' });
    }
  });

  fastify.get('/ocds/milestones/TenK',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getMilestoness_TenK(fastify, riderId);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);
  } catch (err) {
      console.error('Database error milestones TenK:', err);
      return reply.code(500).send({ error: 'Database error milestones TenK' });
    }
  });

  fastify.get('/ocds/outdoorindoor',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getOutdoorIndoor(fastify, riderId);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);
  } catch (err) {
      console.error('Database error outdoorindoor:', err);
      return reply.code(500).send({ error: 'Database error outdoorindoor' });
    }
  });

  fastify.get('/ocds/outdoorindooryearmonth',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getOutdoorIndoorYearMonth(fastify, riderId);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);
  } catch (err) {
      console.error('Database error outdoorindoor:', err);
      return reply.code(500).send({ error: 'Database error outdoorindoor' });
    }
  });

  fastify.get('/ocds/ridedayfractions',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getRideDayFractions(fastify, riderId);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(result);
  } catch (err) {
      console.error('Database error ridedayfractions:', err);
      return reply.code(500).send({ error: 'Database error ridedayfractions' });
    }
  });

  fastify.post('/ocds/refresh/cummulatives',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification
    const { date } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    if ( !date ) {
      return reply.status(400).send({ error: 'Date value is not provided' });
    }

    try {
      const [cummulativesOk, fffOk] = await Promise.all([
        updateCummulatives(fastify, riderId, date),
        updateFFFMetrics(fastify, riderId, date),
        updateRuns(fastify, riderId, date)
      ]);

      return reply.code(200).send( { "cummulativesOk": cummulativesOk, "fffOk":  fffOk} );
    } catch (err) {
      console.error('Error processing cummulatives:', err);
      return reply.code(500).send({ error: `Error processing cummulatives: ${err}` });
    }
  });
}

module.exports = ocdRoutes;
