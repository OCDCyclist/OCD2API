const { getStarredSegments,
        getSegmentEfforts,
        getSegmentEffortsByDOW,
        getSegmentEffortsByMonth,
} = require('../db/dbQueries');

async function segmentRoutes(fastify, options) {
  // Define the segment routes

  fastify.get('/segment/starred',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getStarredSegments(fastify, riderId)

      if (Array.isArray(result)) {
        return reply.code(200).send(result);
      }
      return reply.code(200).send([]);
    } catch (err) {
      console.error('Database error for get_segmentsstrava_data_withtags:', err);
      return reply.code(500).send({ error: 'Database error for get_segmentsstrava_data_withtags' });
    }
  });

  fastify.get('/segment/efforts/:segmentId',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { segmentId } = request.params;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const segid = parseInt(segmentId, 10);
    if (isNaN(segid)) {
      return reply.code(400).send({ error: 'Invalid or missing segmentId' });
    }

    try {
      const result = await getSegmentEfforts(fastify, riderId, segid)

      if (Array.isArray(result)) {
        return reply.code(200).send(result);
      }
      return reply.code(200).send([]);
    } catch (err) {
      console.error('Database error for segment efforts:', err);
      return reply.code(500).send({ error: 'Database error for segment efforts' });
    }
  });

  fastify.get('/segment/byDOW',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getSegmentEffortsByDOW(fastify, riderId)

      if (Array.isArray(result)) {
        return reply.code(200).send(result);
      }
      return reply.code(200).send([]);
    } catch (err) {
      console.error('Database error for segment efforts by day of week:', err);
      return reply.code(500).send({ error: 'Database error for segment efforts by day of week' });
    }
  });

   fastify.get('/segment/byMonth',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getSegmentEffortsByMonth(fastify, riderId)

      if (Array.isArray(result)) {
        return reply.code(200).send(result);
      }
      return reply.code(200).send([]);
    } catch (err) {
      console.error('Database error for segment efforts by month:', err);
      return reply.code(500).send({ error: 'Database error for segment efforts by month' });
    }
  });
}

module.exports = segmentRoutes;
