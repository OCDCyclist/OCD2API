async function segmentRoutes(fastify, options) {
  // Define the segment routes

  fastify.get('/segment/starred',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const params = [id];

    const query = `SELECT * FROM get_segmentsstrava_data_withtags($1)`;

    try {
      const { rows } = await fastify.pg.query(query, params);

      if (rows.length === 0) {
        return reply.code(200).send([]);
      }

      return reply.code(200).send(rows);

    } catch (err) {
      console.error('Database error for get_segmentsstrava_data_withtags:', err);
      return reply.code(500).send({ error: 'Database error for get_segmentsstrava_data_withtags' });
    }
  });
}

module.exports = segmentRoutes;
