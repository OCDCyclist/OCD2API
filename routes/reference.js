const {
  getReferencePowerLevels,
} = require('../db/dbQueries');

async function referenceRoutes(fastify, options) {

  fastify.get('/reference/categoryLevels',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getReferencePowerLevels(fastify, id);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error getReferencePowerLevels:', err);
      return reply.code(500).send({ error: 'Database error getReferencePowerLevels' });
    }
  });

}

module.exports = referenceRoutes;
