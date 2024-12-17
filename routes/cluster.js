const {
  getRidesforCluster,
  getRidesforCentroid,
  setClusterCentroidName,
  setClusterCentroidColor,
  getClusterCentroidDefinitions,
  getAllClusterDefinitions,
  getClusterDefinition,
  getDistinctClusterCentroids,
  getActiveCentroid,
  setClusterActive,
  deleteCluster,
  upsertCluster,
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
    const { clusterId } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const clusterIdValue = parseInt(clusterId, 10);

    if( !clusterIdValue || clusterIdValue === 0 ){
      const row = await getActiveCentroid(fastify, id);
      clusterIdValue = 6;//row.length > 0 ? row[0].clusterid : 0;
    }

    try {
      const result = await getRidesforCentroid(fastify, id, clusterIdValue);

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
          const updateClusterTags = 'CALL update_ride_clusters_with_tags($1,$2)';
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
        reply.status(200).send({status: true, message: "Cluster has been set active."});
      }
      else{
        reply.status(500).send({ error: 'Unable to set cluster active' });
      }

    } catch (error) {
      console.error('Error clustering rides:', error);
      reply.status(500).send({ error: 'An error occurred while setting a cluster active' });
    }

    setImmediate(async () => {
      // After successfully updating a cluster run the code to update the tags
      try {
          // this updates ride metrics like intensity factor, TSS
          const updateClusterTags = 'CALL update_ride_clusters_with_tags($1,$2)';
          await fastify.pg.query(updateClusterTags, [riderId, clusterIdValue]);
      } catch (updateError) {
          console.error('Error updating cluster tags', updateError);
      }
    });
  });

  fastify.get('/cluster/delete', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { clusterid } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const clusterIdValue = parseInt(clusterid, 10);

    if (isNaN(clusterIdValue)) {
      return reply.code(400).send({ error: 'Invalid or missing clusterId' });
    }

    try {
      await deleteCluster(fastify, id, clusterIdValue);
      reply.status(200).send({status: true, message: "Cluster has been deleted."});
    } catch (error) {
      console.error('Error clustering rides:', error);
      reply.status(500).send({ error: 'An error occurred while deleting a cluster' });
    }
  });

  fastify.post('/cluster/centroid/name', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { clusterId, cluster, name } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const clusterIdValue = parseInt(clusterId, 10);

    if (isNaN(clusterIdValue)) {
      return reply.code(400).send({ error: 'Invalid or missing centroidId value' });
    }

    const clusterNumber = parseInt(cluster, 10);
    if (isNaN(clusterNumber)) {
      return reply.code(400).send({ error: 'Invalid or missing centroied number' });
    }

    if (typeof(name) !== 'string' || name.length > 15) {
      return reply.code(400).send({ error: 'Invalid or missing centroid name' });
    }

    try {
      const result = await setClusterCentroidName(fastify, id, clusterIdValue, clusterNumber, name);
      if(result){
        reply.status(200).send({status: true, message: "Centroid name has been updated."});
      }
      else{
        reply.status(500).send({ error: 'Unable to update centroid name' });
      }

    } catch (error) {
      console.error('Error updating centroid name:', error);
      reply.status(500).send({ error: 'An error occurred while updating centroid name' });
    }

    setImmediate(async () => {
      // After successfully updating a cluster run the code to update the tags
      try {
          // this updates ride metrics like intensity factor, TSS
          const updateClusterTags = 'CALL update_ride_clusters_with_tags($1,$2)';
          await fastify.pg.query(updateClusterTags, [riderId, clusterIdValue]);
      } catch (updateError) {
          console.error('Error updating cluster tags', updateError);
      }
    });
  });

  fastify.post('/cluster/centroid/color', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { clusterId, cluster, color } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const clusterIdValue = parseInt(clusterId, 10);

    if (isNaN(clusterIdValue)) {
      return reply.code(400).send({ error: 'Invalid or missing centroidId value' });
    }

    const clusterNumber = parseInt(cluster, 10);
    if (isNaN(clusterNumber)) {
      return reply.code(400).send({ error: 'Invalid or missing centroied number' });
    }

    if (typeof(color) !== 'string' || color.length > 10) {
      return reply.code(400).send({ error: 'Invalid or missing centroid color' });
    }

    try {
      const result = await setClusterCentroidColor(fastify, id, clusterIdValue, clusterNumber, color);
      if(result){
        reply.status(200).send({status: true, message: "Centroid color has been updated."});
      }
      else{
        reply.status(500).send({ error: 'Unable to update centroid color' });
      }

    } catch (error) {
      console.error('Error updating centroid name:', error);
      reply.status(500).send({ error: 'An error occurred while updating centroid color' });
    }

    setImmediate(async () => {
      // After successfully updating a cluster run the code to update the tags
      try {
          // this updates ride metrics like intensity factor, TSS
          const updateClusterTags = 'CALL update_ride_clusters_with_tags($1,$2)';
          await fastify.pg.query(updateClusterTags, [riderId, clusterIdValue]);
      } catch (updateError) {
          console.error('Error updating cluster tags', updateError);
      }
    });
  });

  fastify.get('/cluster/allClusterCentroids', { preValidation: [fastify.authenticate] }, async (request, reply) => {
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

  fastify.get('/cluster/getClusterDefinition', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { clusterId } = request.query;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const clusterIdValue = parseInt(clusterId, 10);

    if (isNaN(clusterIdValue)) {
      return reply.code(400).send({ error: 'Invalid or missing clusterIdValue' });
    }

    try {
      const result = await getClusterDefinition(fastify, id, clusterIdValue);

      if (!Array.isArray(result) || result.length === 0) {
        return reply.code(200).send([]);
      }
      return reply.code(200).send(result[0]);
    } catch (err) {
      console.error('Database error:', err);
      return reply.code(500).send({ error: `Database error: ${error.message}` });
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

  fastify.post('/cluster/update', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { riderId } = request.user;
    const { clusterId, startyear, endyear, clustercount, fields, active } = request.body;

    const id = parseInt(riderId, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid or missing riderId' });
    }

    const clusterIdValue =  clusterId === undefined ? -1 : parseInt(clusterId, 10);

    if (isNaN(clusterIdValue)) {
      return reply.code(400).send({ error: 'Invalid or missing clusterId value' });
    }

    const start = parseInt(startyear, 10);
    if (isNaN(start)) {
      return reply.code(400).send({ error: 'Invalid or missing start year' });
    }

    const end = parseInt(endyear, 10);
    if (isNaN(end)) {
      return reply.code(400).send({ error: 'Invalid or missing end year' });
    }

    const count = parseInt(clustercount, 10);
    if (isNaN(count)) {
      return reply.code(400).send({ error: 'Invalid or missing cluster count' });
    }

    if (typeof(fields) !== 'string') {
      return reply.code(400).send({ error: 'Invalid or missing fields value' });
    }

    if (typeof(active) !== 'boolean') {
      return reply.code(400).send({ error: 'Invalid or active flag' });
    }

    try {
      const result = await upsertCluster(fastify, riderId, clusterIdValue, start, end, count, fields, active);
      if(result){
        reply.status(200).send({status: true, message: "Cluster has been created or updated."});
      }
      else{
        reply.status(500).send({ error: 'Unable to update cluster' });
      }

    } catch (error) {
      console.error('Error creating or updating cluster:', error);
      reply.status(500).send({ error: 'An error occurred while creating or update the cluster' });
    }
  });
}

module.exports = clusterRoutes;
