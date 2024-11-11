const {
  getCummulatives,
  getYearAndMonth,
  getYearAndDOW,
  getMonthAndDOM,
} = require('../db/dbQueries');

async function ocdRoutes(fastify, options) {
  // Define the dashboard route
  fastify.get('/ocds/cummulatives',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

   const id = parseInt(riderId, 10);
   if (isNaN(id)) {
     return reply.code(400).send({ error: 'Invalid or missing riderId' });
   }

   try {
    const result = await getCummulatives(fastify, riderId);

     if (!Array.isArray(result)) {
       return reply.code(200).send([]);
     }

     return reply.code(200).send(result);

   } catch (err) {
     console.error('Database error:', err);
     return reply.code(500).send({ error: 'Database error' });
   }
  });

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
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

}

module.exports = ocdRoutes;
