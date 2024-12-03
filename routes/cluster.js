const {
  getRidesforCluster,
  getRidesforCentroid,
  getClusterCentroidDefinitions,
  getAllClusterDefinitions,
  getDistinctClusterCentroids,
  getActiveCentroid,
  setClusterActive,
} = require('../db/dbQueries');
const { clusterRides } = require('../utility/clustering');

async function clusterRoutes(fastify, options) {

  fastify.get('/cluster/getRidesByCluster',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { startYear, endYear, cluster } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const start = parseInt(startYear, 10);
    if (isNaN(start)) {
      return reply.code(400).send({ error: 'Invalid or missing startYear' });
    }

    const end = parseInt(endYear, 10);
    if (isNaN(end)) {
      return reply.code(400).send({ error: 'Invalid or missing endYear' });
    }

    const clusterValue = parseInt(cluster, 10);
    if (isNaN(clusterValue)) {
      return reply.code(400).send({ error: 'Invalid or missing cluster' });
    }

    try {
      const result = await getRidesforCluster(fastify, id, start, end, clusterValue);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/cluster/getRidesByCentroid',  { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { clusterid } = request.query;

    let clusteridToUse = clusterid;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    if( !clusteridToUse || clusteridToUse === 0 ){
      const row = await getActiveCentroid(fastify, id);
      clusteridToUse = row.length > 0 ? row[0].clusterid : 0;
    }

    try {
      const result = await getRidesforCentroid(fastify, id, clusteridToUse);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/cluster/cluster', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { clusterid } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const clusterIdValue = parseInt(clusterid, 10);

    if (isNaN(clusterIdValue)) {
      return reply.code(400).send({ error: 'Invalid or missing clusterIdValue' });
    }

    try {
      const result = await clusterRides(fastify, id, clusterIdValue);
      if(result){
        reply.status(200).send({status: true, message: "Cluster values have been updated."});
      }
      else{
        reply.status(500).send({ error: 'Unable to update cluster values' });
      }

    } catch (error) {
      console.error('Error clustering rides:', error);
      reply.status(500).send({ error: 'An error occurred while clustering rides' });
    }

    setImmediate(async () => {
      // After successfully updating a cluster run the code to update the tags
      try {
          // this updates ride metrics like intensity factor, TSS
          const updateClusterTags = 'CALL update_ride_clusters_with_tags_year_range($1,$2)';
          await fastify.pg.query(updateClusterTags, [riderId, clusterIdValue]);
      } catch (updateError) {
          console.error('Error updating cluster tags', updateError);
      }
    });
  });

  fastify.get('/cluster/setActive', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { clusterid } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const clusterIdValue = parseInt(clusterid, 10);

    if (isNaN(clusterIdValue)) {
      return reply.code(400).send({ error: 'Invalid or missing clusterIdValue' });
    }

    try {
      const result = await setClusterActive(fastify, id, clusterIdValue);
      if(result){
        reply.status(200).send({status: true, message: "Cluster values have been updated."});
      }
      else{
        reply.status(500).send({ error: 'Unable to update cluster values' });
      }

    } catch (error) {
      console.error('Error clustering rides:', error);
      reply.status(500).send({ error: 'An error occurred while clustering rides' });
    }

    setImmediate(async () => {
      // After successfully updating a cluster run the code to update the tags
      try {
          // this updates ride metrics like intensity factor, TSS
          const updateClusterTags = 'CALL update_ride_clusters_with_tags_year_range($1,$2)';
          await fastify.pg.query(updateClusterTags, [riderId, clusterIdValue]);
      } catch (updateError) {
          console.error('Error updating cluster tags', updateError);
      }
    });
  });

  fastify.get('/cluster/clusterDefinitions', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getClusterCentroidDefinitions(fastify, id);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/cluster/distinctClusterCentroids', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getDistinctClusterCentroids(fastify, id);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  fastify.get('/cluster/getAllClusterDefinitions', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    try {
      const result = await getAllClusterDefinitions(fastify, id);

      if (!Array.isArray(result)) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: `Database error: ${error.message}` });
    }
  });
}

module.exports = clusterRoutes;
