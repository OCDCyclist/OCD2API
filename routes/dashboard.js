async function dashboardRoutes(fastify, options) {
  // Define the dashboard route
  fastify.get('/dashboard/riderSummary',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

   const id = parseInt(riderId, 10);
   if (isNaN(id)) {
     return reply.code(400).send({ error: 'Invalid or missing riderId' });
   }

   const params = [id]; // Array to store query parameters (starting with riderId)

   let query = `SELECT * FROM summarize_rides_and_goals($1)`;
   const client = await fastify.pg.connect();

   try {
    const { rows } = await client.query(query, params);

     // If no rider summaryfound, return an empty array
     if (rows.length === 0) {
       return reply.code(200).send([]);
     }

     // Send the rider summary
     return reply.code(200).send(rows[0]);

   } catch (err) {
     console.error('Database error:', err);
     return reply.code(500).send({ error: 'Database error' });
   }
   finally{
    client.release();
   }
 });
}

module.exports = dashboardRoutes;
