async function dashboardRoutes(fastify, options) {
  // Define the dashboard route
  fastify.get('/ocds/cummulatives',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

   const id = parseInt(riderId, 10);
   if (isNaN(id)) {
     return reply.code(400).send({ error: 'Invalid or missing riderId' });
   }

   const params = [id]; // Array to store query parameters (starting with riderId)

   let query = `SELECT * FROM get_rider_cummulatives_recent($1)`;
   const client = await fastify.pg.connect();

   try {
    const { rows } = await client.query(query, params);

     // If no rider cummulatives are found, return an empty array
     if (rows.length === 0) {
       return reply.code(200).send([]);
     }

     // Send the rider summary
     return reply.code(200).send(rows);

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
