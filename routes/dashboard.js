const {
  getDashboard,
} = require('../db/dbQueries');

async function dashboardRoutes(fastify, options) {
  // Define the dashboard route
  fastify.get('/dashboard/riderSummary',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;  // request.user is populated after JWT verification

   const id = parseInt(riderId, 10);
   if (isNaN(id)) {
     return reply.code(400).send({ error: 'Invalid or missing riderId' });
   }

   try {
    const dashboard = await getDashboard(fastify, riderId);

    return reply.code(200).send(dashboard);

   } catch (err) {
     console.error('Database error:', err);
     return reply.code(500).send({ error: 'Database error' });
   }
 });
}

module.exports = dashboardRoutes;
