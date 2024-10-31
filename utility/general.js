const isEmpty = (argument) => {
    if(typeof(argument) !== 'object' || argument == undefined || argument == null){
        return true;
    }
    return false;
};

module.exports = { isEmpty };