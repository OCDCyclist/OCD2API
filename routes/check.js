
async function checkRoutes(fastify, options) {
  // Define the rides route
  fastify.get('/checkAccess',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    return reply.code(200).send("Access is verified");
  });
}

module.exports = checkRoutes;
