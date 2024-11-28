const { kmeans } = require('ml-kmeans');
const { isRiderId, isFastify, isIntegerValue } = require("../utility/general");
const {
    getRidesForClustering,
    getRidesForClusteringByYear,
    updateRidesForClustering,
    updateClusterCentroids,
    getClusterCentroids,
  } = require('../db/dbQueries');

const clusterRides = async (fastify, riderId, startYear, endYear) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if (!isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(startYear)) {
        throw new TypeError("Invalid parameter: startYearBack must be an integer");
    }

    if ( !isIntegerValue(endYear)) {
        throw new TypeError("Invalid parameter: endYearBack must be an integer");
    }

    const rows = startYear < 2000 ?
        await getRidesForClustering(fastify, riderId, startYear, endYear)
        :
        await getRidesForClusteringByYear(fastify, riderId, startYear, endYear);

    const previousCentroids = await getClusterCentroids(fastify, riderId, startYear, endYear);
    const previousCentroidArray = convertToClusteredArrays(previousCentroids);

    // Separate `rideid` and clustering data
    const rideIds = rows.map(row => row.rideid);
    const data = rows.map(row => [
        row.distance,
        row.speedavg,
        row.elevationgain,
        row.hravg,
        row.powernormalized,
    ]);

    // Step 2: Apply k-means clustering
    const k = 4; // Number of clusters
    const kmeansResult = kmeans(data, k, {maxIterations: 50});

    const { clusters, centroids } = kmeansResult;

    // Sort newArray and get index mapping
    const { sortedArray, indexMapping } = sortByEuclideanDistanceWithIndices(previousCentroidArray, centroids);

    const translatedIndices = translateIndices(clusters, indexMapping);

    // Prepare data for insertion
    const clusterData = rideIds.map((rideid, index) => ({
        rideid,
        cluster: translatedIndices[index],
    }));

    // Step 3: Write cluster data to the database
    const updateResultClusters = await updateRidesForClustering(fastify, riderId, clusterData);
    if (!updateResultClusters) {
        return false;
    }

    // Step 4: Write sorted cluster centroids to the database
    const updateResultCentroids = await updateClusterCentroids(fastify, riderId, startYear, endYear, sortedArray);
    if (!updateResultCentroids) {
        return false;
    }
    return true;
};

function translateIndices(indexArray, indexMapping) {
    // Create a reverse mapping to get the position of original indices in sortedArray
    const reverseMapping = [];
    indexMapping.forEach((originalIndex, sortedIndex) => {
        reverseMapping[originalIndex] = sortedIndex;
    });

    // Translate the indices using the reverse mapping
    return indexArray.map(originalIndex => reverseMapping[originalIndex]);
};

function sortByEuclideanDistanceWithIndices(arr1, arr2) {
    // Helper function to calculate Euclidean distance between two rows
    const euclideanDistance = (row1, row2) =>
        Math.sqrt(row1.reduce((sum, val, i) => sum + Math.pow(val - row2[i], 2), 0));

    // Add original indices to arr2
    const indexedArr2 = arr2.map((row, index) => ({ row, index }));

    // Sort based on cumulative Euclidean distance
    indexedArr2.sort((a, b) => {
        const distA = arr1.reduce((sum, row) => sum + euclideanDistance(row, a.row), 0);
        const distB = arr1.reduce((sum, row) => sum + euclideanDistance(row, b.row), 0);
        return distA - distB;
    });

    // Extract the sorted rows and track index changes
    const sortedArray = indexedArr2.map(item => item.row);
    const indexMapping = indexedArr2.map(item => item.index); // New indices of original rows

    return { sortedArray, indexMapping };
}

function convertToClusteredArrays(data) {
    // Sort data by cluster index
    const sortedData = data.slice().sort((a, b) => a.cluster - b.cluster);

    // Map each object to an array of the specified values
    return sortedData.map(item => [
        item.startyear,
        item.endYear,
        item.distance,
        item.speedavg,
        item.elevationgain,
        item.hravg,
        item.powernormalized
    ]);
}

module.exports = { clusterRides };