const isEmpty = (argument) => {
    if(typeof(argument) !== 'object' || argument == undefined || argument == null){
        return true;
    }
    return false;
};

const isFastify = (fastify) => {
    // Validate the fastify object and pg plugin
    if (!fastify || typeof fastify.pg?.query !== 'function') {
        throw new Error("Invalid 'fastify' object or 'pg' plugin not registered");
    }
    return true;
}

const isIntegerValue = (theValue) =>{
    if (typeof(theValue) !== 'number' || !Number.isInteger(theValue)) {
        return false;
    }
    return theValue;
}

function isValidNumber(value) {
    return typeof value === 'number' && !isNaN(value);
}

const isRiderId = (riderId) => isIntegerValue(riderId);
const isSegmentId = (segmentId) => isIntegerValue(segmentId);
const isLocationId = (locationId) => isIntegerValue(locationId);
const isAssignmentId = (assignmentId) => isIntegerValue(assignmentId);

const isValidDate = (dateString) => {
    const date = new Date(dateString);
    return !isNaN(date.getTime());
}

/**
 * Checks if every element in an array is a non-blank string up to 30 characters long.
 * @param {string[]} arr - The array to validate.
 * @returns {boolean} - Returns true if all elements pass the validation, otherwise false.
 */
const isValidTagArray = (arr) => {
    return Array.isArray(arr) && arr.every(
        (str) => typeof str === 'string' && str.trim() !== '' && str.length <= 30
    );
}

module.exports = { isEmpty, isFastify, isRiderId, isSegmentId, isLocationId, isAssignmentId, isValidDate, isValidTagArray, isValidNumber, isIntegerValue };