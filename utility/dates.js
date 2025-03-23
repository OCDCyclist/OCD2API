const dayjs = require('dayjs');

// Utility to round up to the nearest day
const getRoundedCurrentDateISO = () => {
    return dayjs().add(1, 'day').startOf('day').toISOString();
}

// Function to get the date 6 months before a given date
const getSixMonthsEarlier= (date) => {
    return dayjs(date).subtract(6, 'months').startOf('day').toISOString();
}

// Function to get the date 12 months before a given date
const getTwelveMonthsEarlier= (date) => {
    return dayjs(date).subtract(12, 'months').startOf('day').toISOString();
}

// Function to get the date 5 years before a given date
const getFiveYearsEarlier= (date) => {
    return dayjs(date).subtract(5, 'years').startOf('day').toISOString();
}

// Function to format date-time in 'YYYY-MM-DD HH:mm:ss' format
function formatDateTimeYYYYMMDDHHmmss(date) {
    return date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0') + ' ' +
        String(date.getHours()).padStart(2, '0') + ':' +
        String(date.getMinutes()).padStart(2, '0') + ':' +
        String(date.getSeconds()).padStart(2, '0');
}


module.exports = { getRoundedCurrentDateISO, getSixMonthsEarlier, getTwelveMonthsEarlier, getFiveYearsEarlier, formatDateTimeYYYYMMDDHHmmss };