const { kmeans } = require('ml-kmeans');
const { isRiderId, isFastify, isIntegerValue } = require("../utility/general");
const {
    getRidesForClusteringByYear,
    updateRidesForClustering,
    updateClusterCentroids,
    getClusterCentroids,
    getClusterDefinition,
} = require('../db/dbQueries');


// Convert centroids back to the original scale
const revertNormalization = (normalizedCentroidsToRevert, minMax) =>
    normalizedCentroidsToRevert.map(normalizedCentroid =>
    normalizedCentroid.map((val, colIdx) => val * (minMax[colIdx].max - minMax[colIdx].min) + minMax[colIdx].min)
);

const minMaxValues = (data) =>{
    if( !Array.isArray(data) || data.length === 0){ return [];}
    //  Normalize the data (min-max scaling)
    const minMax = data[0].map((_, colIdx) => {
        const col = data.map(row => row[colIdx]);
        return { min: Math.min(...col), max: Math.max(...col) };
    });
    return minMax;
};

const normalize = data =>{
    const minMax = minMaxValues(data);
    const normalized = data.map(row =>
        row.map((val, colIdx) => (val - minMax[colIdx].min) / (minMax[colIdx].max - minMax[colIdx].min))
    );
    return [minMax, normalized];
};

const combineScaledAndNormalizedArray = (scaled, normalized)=>{
    if(!Array.isArray(scaled) || !Array.isArray(normalized)) return [];
    if(scaled.length === 0 || normalized.length === 0) return [];
    if(scaled.length !== normalized.length) return [];

    const combined = scaled.map((scaledInnerArray, index) => {
        const normalizedInnerArray = normalized[index];
        return [...scaledInnerArray, ...normalizedInnerArray];
    });
    return combined;
};

const clusterRides = async (fastify, riderId, clusterId) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if (!isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(clusterId)) {
        throw new TypeError("Invalid parameter: clusterId must be an integer");
    }

    // Lookup cluster definition
    const clusterDefinitions = await getClusterDefinition(fastify, riderId, clusterId);
    if ( !Array.isArray(clusterDefinitions) || clusterDefinitions.length === 0) {
        throw new TypeError("Invalid cluster definition: there must be a unique cluster to use");
    }
    const clusterDefinition = clusterDefinitions[0];

    const rows = await getRidesForClusteringByYear(fastify, riderId, clusterDefinition.clusterid);

    // Separate `rideid` and clustering data
    const rideIds = rows.map(row => row.rideid);
    const data = rows.map(row => [
        row.distance,
        row.speedavg,
        row.elevationgain,
        row.hravg,
        row.powernormalized,
    ]);

    const[minMax, normalized] = normalize(data);

    // Apply k-means clustering
    const k = 4; // Number of clusters
    const kmeansNormalizedResult = kmeans(normalized, k, {maxIterations: 50});

    const { clusters: newClusters, centroids: newCentroidsNormalized } = kmeansNormalizedResult;

    const oldCentroidRecords = await getClusterCentroids(fastify, riderId, clusterDefinition.clusterid, 'normalized');

    const oldCentroidNormalized = convertToClusteredArrays(oldCentroidRecords, true);
    // Sort newArray and get index mapping
    const { sortedArray, indexMapping } = sortByEuclideanDistanceWithIndices(oldCentroidNormalized, newCentroidsNormalized);

    const translatedIndices = translateIndices(newClusters, indexMapping);
    const newCentroidsScaled = revertNormalization(sortedArray, minMax);

    // Prepare data for insertion
    const clusterData = rideIds.map((rideid, index) => ({
        rideid,
        clusterid: clusterDefinition.clusterid,
        cluster: translatedIndices[index],
    }));

    // Write cluster data to the database
    const updateResultClusters = await updateRidesForClustering(fastify, riderId, clusterData);
    if (!updateResultClusters) {
        return false;
    }

    // Combine the scale and normalized data into one array
    const newCentroidData = combineScaledAndNormalizedArray(newCentroidsScaled, sortedArray);

    // Write normalized and scaled cluster centroids to the database
    const updateResultCentroids = await updateClusterCentroids(fastify, riderId, clusterDefinition.clusterid, newCentroidData);
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

function convertToClusteredArrays(data, useNormalized) {
    // Sort data by cluster index
    const sortedData = data.slice().sort((a, b) => a.cluster - b.cluster);

    // Map each object to an array of the specified values
    if(useNormalized){
        return sortedData.map(item => [
            item.distance_n,
            item.speedavg_n,
            item.elevationgain_n,
            item.hravg_n,
            item.powernormalized_n
        ]);
        }
    else{
        return sortedData.map(item => [
            item.distance,
            item.speedavg,
            item.elevationgain,
            item.hravg,
            item.powernormalized
        ]);
    }
}

module.exports = { clusterRides };