const { getStarredSegments,
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
}

module.exports = segmentRoutes;
