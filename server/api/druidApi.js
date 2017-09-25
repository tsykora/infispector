var app = require('../../app.js');
var RSVP = require('rsvp');
var localhost = true; // set false if not working locally

var params = (localhost) ? {host: "127.0.0.1:8084", debug: "true"} : {host: "druid-solo:8084", debug: "true"};
var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

// TODO: pass this as a parameter when starting grunt to enable/disable log messages
// without the need of code change here
var druid_debug_enabled = true;
var debug = function (msg) {
    if (druid_debug_enabled) {
        console.log(msg);
    }
}

/*
 * Function asks druid instance for the list of communication nodes
 * and internally parses the result in order to return clear list of nodes.
 * 
 * @param {type} request
 * @param {type} response
 * @returns list of communication nodes
 */
exports.getNodes = function (request, response) {

    debug('Called getNodes function in druidApi.js.');

    var druidQueryJson = createGeneralTopNDruidQueryBase("dest", "length");
    // --> no filter here, not needed <--
    setAggregationsToDruidQueryBase(druidQueryJson, "count", "length", "length");
    setIntervalsToDruidQueryBase(druidQueryJson); // no from/toTime, use default

    druidRequester(druidQueryJson)
            .then(function (result) {
                var res = JSON.stringify(result[0]);
                var reg = /(?:\"dest\")\s*:\s*\".*?\"/g;
                var nodeField = res.match(reg);

                for (var i = 0; i < nodeField.length; i++) {
                    nodeField[i] = nodeField[i].replace('"dest":"', "").replace('\"', "");
                }
                debug("Result of getNodes function (druidApi): " + nodeField);
                response.send({error: 0, jsonResponseAsString: JSON.stringify(nodeField)}, 201);
            })
            .done();
};

/**
 * Function that returns final count of messages from src node
 * to dest node in a given time interval with respective filter
 *
 * Possible Infinispan related filters (for more charts on dashboard) --
 * [SingleRpcCommand, CacheTopologyControlCommand, StateResponseCommand, StateRequestCommand]
 *
 * @param srcNode
 * @param destNode
 * @param searchMessageText
 * @param fromTime (format: 2000-10-01T00:00)
 * @param toTime (format: 2000-10-01T00:00)
 */
var getMessagesCountIntern = function (srcNode, destNode, searchMessageText, fromTime, toTime/*zmena*/, group1, group2/*konec*/) {
    return new Promise(function (resolve, reject) {
        debug('getMessagesCountIntern function from druidApi.js was called.');
        // dimension is "src" now
        // when dimension would be "message" we can get aggregation through
        // different messages and their count
        var druidQueryJson = createGeneralTopNDruidQueryBase("src", "length");
        setFilterToDruidQueryBase(druidQueryJson, "and", srcNode, destNode, searchMessageText);
        setAggregationsToDruidQueryBase(druidQueryJson, "count", "length", "length");
        setIntervalsToDruidQueryBase(druidQueryJson, fromTime, toTime); // no from/toTime, use default
        druidRequester(druidQueryJson).then(function (result) {
            var res = JSON.stringify(result[0]);
            var reg = /(?:"length":)[0-9]+/g;
            /* zmena */
            srcNode = group1;
            destNode = group2;
            /* konec */
            var messagesCount = res.match(reg);
            if (messagesCount === null) {
                // resolve with 0 messages count for now
                // TODO -- look here at proper handling
                resolve([srcNode, destNode, 0]);
            } else {
                messagesCount = messagesCount[0].replace('"length":', "");

                debug("in getMessagesCountIntern extracted messagesCount from: "
                        + res + " = " + messagesCount);
                resolve([srcNode, destNode, messagesCount]);
            }
        }).done();
    }); // promise
};

var getMsgCnt = function (fromTime, toTime) {
    return new Promise(function (resolve, reject) {
        debug('getMsgCnt function from druidApi.js was called.');
        var druidQueryJson = createGeneralTopNDruidQueryBase("src", "length");
        setIntervalsToDruidQueryBase(druidQueryJson, fromTime, toTime);
        druidRequester(druidQueryJson).then(function (result) {
            var res = JSON.stringify(result[0]);
            var reg = /(?:"length":)[0-9]+/g;
            var messagesCount = res.match(reg);
            if (messagesCount == null) {
                resolve(0);
            }
            else {
                messagesCount = messagesCount[0].replace('"length":', "");
                debug("in getMsgCnt extracted messagesCount from: " + res + "=" + messagesCount);
                resolve(messagesCount);
            }
        }).done();
    });
};

/*
 * Function that returns messages and timestamp from given src node
 */
exports.getMessagesInfo = function (request, response) {

    debug('getMessagesInfo function from druidApi.js was called. '
            + request.body.nodeName);

    var srcNode = request.body.nodeName;
    //var filter = request.body.filter;
    var destNode = null;
    var searchMessageText = request.body.filter;

    var druidQueryJson = createGeneralTopNDruidQueryBase("message", "length");
    setFilterToDruidQueryBase(druidQueryJson, "and", srcNode, destNode, searchMessageText);
    setAggregationsToDruidQueryBase(druidQueryJson, "count", "length", "length");
    setIntervalsToDruidQueryBase(druidQueryJson); // no from/toTime, use default

    druidRequester(druidQueryJson)
            .then(function (result) {
                debug(JSON.stringify(result));
                response.send({error: 0, jsonResponseAsString: JSON.stringify(result)}, 201);
            })
            .done();
};

/**
 * Returns the time of the first message in monitored communication
 *
 * TODO: adjust our query "builder" in druidApi.js if needed
 */
exports.getMinimumMessageTime = function (request, response) {

    debug('getMinimumMessageTime function in druidApi.js was called. ');

    druidRequester({
        query: {
            "queryType": "timeseries",
            "dataSource": "InfiSpectorTopic",
            "granularity": "all",
            "descending": "true",
            "aggregations": [
                {"type": "doubleMin", "fieldName": "timestamp", "name": "__time"}
            ],
            "intervals": ["2009-10-01T00:00/2020-01-01T00"]
        }
    })
            .then(function (result) {

                response.send({error: 0, jsonResponseAsString: JSON.stringify(result)}, 201);
                console.log("\n\nResult: Maximum" + JSON.stringify(result));
            })
            .done();
};


/**
 * Returns the time of the last message in monitored communication
 *
 * TODO: adjust our query "builder" in druidApi.js if needed
 */
exports.getMaximumMessageTime = function (request, response) {

    debug('getMaximumMessageTime function in druidApi.js was called. ');

    druidRequester({
        query: {
            "queryType": "timeseries",
            "dataSource": "InfiSpectorTopic",
            "granularity": "all",
            "descending": "true",
            "aggregations": [
                {"type": "doubleMax", "fieldName": "timestamp", "name": "__time"}
            ],
            "intervals": ["2009-10-01T00:00/2020-01-01T00"]
        }
    })
            .then(function (result) {

                response.send({error: 0, jsonResponseAsString: JSON.stringify(result)}, 201);
                console.log("\n\nResult: Maximum" + JSON.stringify(result));
            })
            .done();
};

// TODO -- move to chartingApi.js and require druidApi.js
exports.getFlowChartMatrix = function (request, response) {
    var groups = request.body.nodes;
    var from = request.body.from;
    var to = request.body.to;
    var searchMessageText = request.body.searchMessageText;
    var numberOfGroups = groups.length;
    var matrix = [];
    var promises = [];
    var srcGroup = "";
    var dstGroup = "";
    for (var i1 = 0; i1 < numberOfGroups; i1++) {
        for (var i2 = 0; i2 < groups[i1].length; i2++) {
           for (var i3 = 0; i3 < numberOfGroups; i3++) {
               for (var i4 = 0; i4 < groups[i3].length; i4++) {
                   if (groups[i1].length === 1) {
                       srcGroup = groups[i1][i2].nodeName;
                       srcGroup = srcGroup.substr(1);
                       srcGroup = srcGroup.substr(0, srcGroup.length-1);
                   }
                   else {
                       srcGroup = "group" + i1.toString();
                   }
                   if (groups[i3].length === 1) {
                       dstGroup = groups[i3][i4].nodeName;
                       dstGroup = dstGroup.substr(1);
                       dstGroup = dstGroup.substr(0, dstGroup.length-1);
                   }
                   else {
                       dstGroup = "group" + i3.toString();
                    }
                    promises = promises.concat(getMessagesCountIntern(
                           JSON.parse(groups[i1][i2].nodeName), JSON.parse(groups[i3][i4].nodeName),
                           searchMessageText, from, to, srcGroup, dstGroup));
               }
           }
        }
    }
    // one matrix element is an [srcNode, destNode, messagesCount] array
    // each promise returns such an array
    // matrixElements is array of those arrays, ordered as executed and returned
    RSVP.all(promises).then(function (matrixElements) {
        for (var x = 0; x < matrixElements.length; x++) {
            matrix[x] = matrixElements[x];
        }
        var tmp = 0;
        for (var i = 0; i < matrix.length; i++) {
            for (var j = 0; j < matrix.length; j++) {
                if (i === j) {
                    continue;
                }
                if (matrix[i][0] === matrix[j][0] && matrix[i][1] === matrix[j][1]) {
                    tmp = matrix[j][2];
                    matrix.splice(j, 1);
                    matrix[i][2] = parseInt(tmp) + parseInt(matrix[i][2]);
                }
            }
        }
        response.send({error: 0, matrix: JSON.stringify(matrix), searchMessage: JSON.stringify(searchMessageText)}, 201);

    }).catch(function (reason) {
        console.log("At least one of the promises FAILED: " + reason);
    });
};

// TODO -- move to chartingApi.js and require druidApi.js
exports.getChordDiagramMatrix = function (request, response) {
    var nodes = request.body.nodes;
    var from = request.body.from;
    var to = request.body.to;
    // we will create one chart for every significant message type / pattern
    var searchMessageText = request.body.searchMessageText;
    var numberOfNodes = nodes.length;
    var matrix = [];
    var promises = [];
    for (var i = 0; i < numberOfNodes; i++) {
        for (var j = 0; j < numberOfNodes; j++) {
            promises = promises.concat(getMessagesCountIntern(
                    JSON.parse(nodes[i].nodeName), JSON.parse(nodes[j].nodeName),
                    searchMessageText, from, to));
        }
    }

    RSVP.all(promises).then(function (matrixElements) {
        for (var i = 0; i < numberOfNodes; i++) {
            matrix[i] = [];
            for (var j = 0; j < numberOfNodes; j++) {
                matrix[i][j] = JSON.parse(matrixElements[i * numberOfNodes + j][2]);
            }
        }
        response.send({error: 0, matrix: JSON.stringify(matrix), searchMessage: JSON.stringify(searchMessageText)}, 201);
    });
};


// EXAMPLE QUERY
// { query: {
//            "queryType": "topN",
//            "dataSource": "InfiSpectorTopic",
//            "granularity": "all",
//            "dimension": "count",
//            "metric": "length",
//            "threshold": 100000,
//            "filter": {
//                    "type": "and",
//                    "fields": [
//                        {
//                            "type": "selector",
//                            "dimension": "src",
//                            "value": srcNode
//                        },
//                        {
//                            "type": "selector",
//                            "dimension": "dest",
//                            "value": destNode
//                        },
//                        {
//                            "type": "search",
//                            "dimension": "message",
//                            "query": {
//                                "type": "insensitive_contains",
//                                "value": "SingleRpcCommand"
//                        }
//                    ]
//                }
//            },
//            "aggregations": [{"type": "count", "fieldName": "length", "name": "length"}],
//            "intervals": [fromTime + "/" + toTime]
// }}

// QUERY JSON BUILDER SECTION

/**
 * @param dimension - mandatory - dimension to query (Druid: A String or
 * JSON object defining the dimension that you want the top taken for.)
 *
 * @param metric - mandatory - metric to query (Druid: A String or JSON object
 * specifying the metric to sort by for the top list.)
 */
var createGeneralTopNDruidQueryBase = function (dimension, metric) {
    var queryJson = {};
    queryJson.query = {};
    queryJson.query.queryType = "topN";
    queryJson.query.dataSource = "InfiSpectorTopic";
    queryJson.query.granularity = "all";
    queryJson.query.dimension = dimension;
    queryJson.query.metric = metric;
    queryJson.query.threshold = "100000"; // TODO: check -- is this enough?
    return queryJson;
}

/**
 * @param queryJson - mandatory
 * @param filterOperand - use 'and' or 'or'
 * @param srcNode - mandatory
 * @param destNode - optional
 * @param searchMessageText - optional - runs 'insensitive_contains' on dimension 'message'
 */
var setFilterToDruidQueryBase = function (queryJson, filterOperand, srcNode, destNode, searchMessageText) {

    queryJson.query.filter = {};
    queryJson.query.filter.type = filterOperand;
    queryJson.query.filter.fields = [];

    queryJson.query.filter.fields.push({
        "type": "selector",
        "dimension": "src",
        "value": srcNode});

    if (destNode) {
        queryJson.query.filter.fields.push({
            "type": "selector",
            "dimension": "dest",
            "value": destNode});
    }

    if (searchMessageText) {
        queryJson.query.filter.fields.push({
            "type": "search",
            "dimension": "message",
            "query": {
                "type": "insensitive_contains",
                "value": searchMessageText
            }});
    }
}

/**
 * @param queryJson - mandatory
 * @param type - mandatory
 * @param fieldName - mandatory
 * @param name - mandatory
 */
var setAggregationsToDruidQueryBase = function (queryJson, type, fieldName, name) {
    queryJson.query.aggregations = [];
    queryJson.query.aggregations.push({"type": type, "fieldName": fieldName, "name": name});
}

var setIntervalsToDruidQueryBase = function (queryJson, fromTime, toTime) {
    if (fromTime && toTime) {
        queryJson.query.intervals = [fromTime + "/" + toTime];
    } else {
        console.log("In setIntervalsToDruidQueryBase: fromTime or toTime not specified, using default 50 years (2000-2050).")
        queryJson.query.intervals = ["2000-10-01T00:00/2050-01-01T00"];
    }
}

//specimen
    exports.queryDruid = function (request, response) {

        console.log('queryDruid function from druidApi.js was called. '
            + request.body.payload + " " + request.body.myQuery);

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

        druidRequester({
            query: {
                "queryType": "topN",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "dimension": "dest",
                "metric": "length",
                "threshold": 5,
                "aggregations": [
                    {"type": "count", "fieldName": "length", "name": "length"}
                ],
                "intervals": ["2009-10-01T00:00/2020-01-01T00"]
            }
        })
            .then(function (result) {
                console.log('***Result: ', result[0]);

                response.send({error: 0, jsonResponseAsString: JSON.stringify(result[0])}, 201);
                //response.json("{result: " + result[0].result[1] + " }");
            })
            .done();
    };


// function that returns field of nodes
//// add null to nodes in .getNodes method
    exports.getNodes = function (request, response) {

        console.log('getNodes function from druidApi.js was called.');

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

        druidRequester({
            query: {
                "queryType": "topN",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "dimension": "dest",
                "metric": "length",
                "threshold": 100000,
                "aggregations": [
                    {"type": "count", "fieldName": "length", "name": "length"}
                ],
                "intervals": ["2009-10-01T00:00/2020-01-01T00"]
            }
        })
            .then(function (result) {
                var test = JSON.stringify(result[0]);
                var reg = /(?:\"dest\")\s*:\s*\".*?\"/g;
                var nodeField = test.match(reg);

                for (var i = 0; i < nodeField.length; i++) {
                    nodeField[i] = nodeField[i].replace('"dest":"', "").replace('\"', "");
                }
                console.log("\n Result of getNodes function (druidApi): " + nodeField);

                response.send({error: 0, jsonResponseAsString: JSON.stringify(nodeField)}, 201);
            })
            .done();
    };


    /*
     @brief function which returns final count of messages from src node to dest node
     @param srcNode
     @param destNode
     @return JSON
     */

    exports.getMessagesCount = function (request, response) {

        console.log('getMessagesCount function from druidApi.js called. '
            + request.body.srcNode + " " + request.body.destNode);

        var srcNode = request.body.srcNode;
        var destNode = request.body.destNode;

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

        druidRequester({
            query: {
                "queryType": "topN",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "dimension": "length",
                "metric": "length",
                "threshold": 10000,
                "filter": {
                    "type": "and",
                    "fields": [
                        {
                            "type": "selector",
                            "dimension": "src",
                            "value": srcNode
                        },
                        {
                            "type": "selector",
                            "dimension": "dest",
                            "value": destNode
                        }
                    ]
                },
                "aggregations": [
                    {"type": "count", "fieldName": "length", "name": "length"}
                ],
                "intervals": ["2009-10-01T00:00/2020-01-01T00"]
            }
        })

            .then(function (result) {

                var test = JSON.stringify(result[0]);
                var reg = /(?:"length":)[0-9]+/g;
                var messagesCount = test.match(reg);
                messagesCount = messagesCount[0].replace('"length":', "");

                //console.log(messagesCount);

                response.send({error: 0, jsonResponseAsString: JSON.stringify(messagesCount)}, 201);
            })
            .done();
    };

    /*
     @brief function which returns final count of messages from src node to dest node and from given time interval
     @param srcNode
     @param destNode
     @param fromTime
     @param toTime
     @return string
     */

    exports.getMessagesCountInInterval = function (request, response) {

        console.log('getMessagesCountInInterval function from druidApi.js was called. '
            + request.body.srcNode + " " + request.body.destNode
            + " " + request.body.fromTime + " " + request.body.toTime);

        var srcNode = request.body.srcNode;
        var destNode = request.body.destNode;
        var fromTime = request.body.fromTime;
        var toTime = request.body.toTime;

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

        druidRequester({
            query: {
                "queryType": "topN",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "dimension": "length",
                "metric": "length",
                "threshold": 10000,
                "filter": {
                    "type": "and",
                    "fields": [
                        {
                            "type": "selector",
                            "dimension": "src",
                            "value": srcNode
                        },
                        {
                            "type": "selector",
                            "dimension": "dest",
                            "value": destNode
                        }
                    ]
                },
                "aggregations": [
                    {"type": "count", "fieldName": "length", "name": "length"}
                ],
                "intervals": [fromTime + "/" + toTime]
            }
        })
            .then(function (result) {

                var test = JSON.stringify(result[0]);
                var reg = /(?:"length":)[0-9]+/g;
                var messagesCount = test.match(reg);
                messagesCount = messagesCount[0].replace('"length":', "");

                console.log(messagesCount);

                response.send({error: 0, jsonResponseAsString: JSON.stringify(messagesCount)}, 201);
            })
            .done();
    };

    /*
     * Stejne jako getMessagesCountInInterval, akorat pro vnitrni pouziti bez nutnosti requestu
     */
    var getMessagesCountInIntervalIntern = function (srcNode, destNode, fromTime, toTime) {

        return new Promise(function (resolve, reject) {

            //var params = {host: "127.0.0.1:8084", debug: "true"};
            //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

            druidRequester({
                query: {
                    "queryType": "topN",
                    "dataSource": "InfiSpectorTopic",
                    "granularity": "all",
                    "dimension": "length",
                    "metric": "length",
                    "threshold": 10000,
                    "filter": {
                        "type": "and",
                        "fields": [
                            {
                                "type": "selector",
                                "dimension": "src",
                                "value": srcNode
                            },
                            {
                                "type": "selector",
                                "dimension": "dest",
                                "value": destNode
                            }
                        ]
                    },
                    "aggregations": [
                        {"type": "count", "fieldName": "length", "name": "length"}
                    ],
                    "intervals": [fromTime + "/" + toTime]
                }
            })
                .then(function (result) {

                    var test = JSON.stringify(result[0]);
                    var reg = /(?:"length":)[0-9]+/g;
                    var messagesCount = test.match(reg);
                    messagesCount = messagesCount[0].replace('"length":', "");
                    resolve(messagesCount);
                })
                .done();
        }); // promise
    };


    /**
     * function that returns number of CacheTopologyControlCommand messages
     */
    exports.getMessagesCountOfControlCache = function (request, response) {

        console.log('getMessagesCountOfControlCachefunction from druidApi.js was called. ');

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

        druidRequester({
            query: {
                "queryType": "topN",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "dimension": "count",
                "metric": "length",
                "threshold": 100000,
                "filter": {
                    "type": "search",
                    "dimension": "message",
                    "query": {
                        "type": "insensitive_contains",
                        "value": "CacheTopologyControlCommand"
                    }
                },
                "aggregations": [
                    {"type": "count", "fieldName": "length", "name": "length"}
                ],
                "intervals": ["2009-10-01T00:00/2020-01-01T00"]
            }
        })
            .then(function (result) {

                var test = JSON.stringify(result[0]);
                var reg = /(?:"length":)[0-9]+/g;
                var messagesCount = test.match(reg);
                messagesCount = messagesCount[0].replace('"length":', "");

                response.send({error: 0, jsonResponseAsString: JSON.stringify(messagesCount)}, 201);
                console.log("\n\nResult: " + JSON.stringify(messagesCount));
            })
            .done();
    };

    /**
     * function that returns number of CacheTopologyControlCommand messages in given interval
     */
    exports.getMessagesCountOfControlCacheInInterval = function (request, response) {

        console.log('getMessagesCountOfControlCacheInInterval function from druidApi.js was called. '
            + " " + request.body.fromTime + " " + request.body.toTime);

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

        var fromTime = request.body.fromTime;
        var toTime = request.body.toTime;

        druidRequester({
            query: {
                "queryType": "topN",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "dimension": "count",
                "metric": "length",
                "threshold": 100000,
                "filter": {
                    "type": "search",
                    "dimension": "message",
                    "query": {
                        "type": "insensitive_contains",
                        "value": "CacheTopologyControlCommand"
                    }
                },
                "aggregations": [
                    {"type": "count", "fieldName": "length", "name": "length"}
                ],
                "intervals": [fromTime + "/" + toTime]
            }
        })
            .then(function (result) {

                var test = JSON.stringify(result[0]);
                var reg = /(?:"length":)[0-9]+/g;
                var messagesCount = test.match(reg);
                messagesCount = messagesCount[0].replace('"length":', "");

                response.send({error: 0, jsonResponseAsString: JSON.stringify(messagesCount)}, 201);
                console.log("\n\nResult: " + JSON.stringify(messagesCount));
            })
            .done();
    };


    /**
     * function that returns number of SingleRpcCommand messages
     */
    exports.getMessagesCountOfSingleRpc = function (request, response) {

        console.log('getMessagesCountOfSingleRpcCommand function from druidApi.js was called. ');

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

        druidRequester({
            query: {
                "queryType": "topN",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "dimension": "count",
                "metric": "length",
                "threshold": 100000,
                "filter": {
                    "type": "search",
                    "dimension": "message",
                    "query": {
                        "type": "insensitive_contains",
                        "value": "SingleRpcCommand"
                    }
                },
                "aggregations": [
                    {"type": "count", "fieldName": "length", "name": "length"}
                ],
                "intervals": ["2009-10-01T00:00/2020-01-01T00"]
            }
        })
            .then(function (result) {

                var test = JSON.stringify(result[0]);
                var reg = /(?:"length":)[0-9]+/g;
                var messagesCount = test.match(reg);
                messagesCount = messagesCount[0].replace('"length":', "");

                response.send({error: 0, jsonResponseAsString: JSON.stringify(messagesCount)}, 201);
                console.log("\n\nResult: " + JSON.stringify(messagesCount));
            })
            .done();
    };

    /**
     * function that returns number of SingleRpcCommand messages in given interval
     */
    exports.getMessagesCountOfSingleRpcInInterval = function (request, response) {

        console.log('getMessagesCountOfSingleRpcCommandInInterval function from druidApi.js was called. ');

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);
        var fromTime = request.body.fromTime;
        var toTime = request.body.toTime;

        druidRequester({
            query: {
                "queryType": "topN",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "dimension": "count",
                "metric": "length",
                "threshold": 100000,
                "filter": {
                    "type": "search",
                    "dimension": "message",
                    "query": {
                        "type": "insensitive_contains",
                        "value": "SingleRpcCommand"
                    }
                },
                "aggregations": [
                    {"type": "count", "fieldName": "length", "name": "length"}
                ],
                "intervals": [fromTime + "/" + toTime]
            }
        })
            .then(function (result) {

                var test = JSON.stringify(result[0]);
                var reg = /(?:"length":)[0-9]+/g;
                var messagesCount = test.match(reg);
                messagesCount = messagesCount[0].replace('"length":', "");

                response.send({error: 0, jsonResponseAsString: JSON.stringify(messagesCount)}, 201);
                console.log("\n\nResult: " + JSON.stringify(messagesCount));
            })
            .done();
    };


    /*
    * function that returns messages and timestamp from given node
    */
///////////// TO DO dodelat!!!!!!!
    exports.getMessagesAndTimestampFromNode = function (request, response) {

        console.log('getMessagesAndTimestampFromNode function from druidApi.js was called. '
            + request.body.srcNode);

        var srcNode = "marek-9119";//request.body.srcNode;

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

        druidRequester({
            query: {
                "queryType": "topN",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "dimension": "message",
                "metric": "length",
                "threshold": 100000,
                "filter": {
                    "type": "search",
                    "dimension": "message",
                    "query": {
                        "type": "insensitive_contains",
                        "value": "CacheTopologyControlCommand"
                    }
                },
                "aggregations": [
                    {"type": "count", "fieldName": "length", "name": "length"}
                ],
                "intervals": ["2009-10-01T00:00/2020-01-01T00"]
            }
        })
            .then(function (result) {

                console.log(JSON.stringify(result));
                response.send({error: 0, jsonResponseAsString: JSON.stringify(result)}, 201);


            })
            .done();
    };

    /**
     * function that returns bottom value of the slider
     */
    exports.getBottomSliderValue = function (request, response) {

        console.log('getBottomSliderValue function from druidApi.js was called. ');

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

        druidRequester({
            query: {
                "queryType": "timeseries",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "descending": "true",
                "aggregations": [
                    {"type": "doubleMin", "fieldName": "timestamp", "name": "__time"}
                ],
                "intervals": ["2009-10-01T00:00/2020-01-01T00"]
            }
        })
            .then(function (result) {

                response.send({error: 0, jsonResponseAsString: JSON.stringify(result)}, 201);
                console.log("\n\nResult: Maximum" + JSON.stringify(result));
            })
            .done();
    };


    /**
     * function that returns top value of the slider
     */
    exports.getTopSliderValue = function (request, response) {

        console.log('getTopSliderValue function from druidApi.js was called. ');

        //var params = {host: "127.0.0.1:8084", debug: "true"};
        //var druidRequester = require('plywood-druid-requester').druidRequesterFactory(params);

        druidRequester({
            query: {
                "queryType": "timeseries",
                "dataSource": "InfiSpectorTopic",
                "granularity": "all",
                "descending": "true",
                "aggregations": [
                    {"type": "doubleMax", "fieldName": "timestamp", "name": "__time"}
                ],
                "intervals": ["2009-10-01T00:00/2020-01-01T00"]
            }
        })
            .then(function (result) {

                response.send({error: 0, jsonResponseAsString: JSON.stringify(result)}, 201);
                console.log("\n\nResult: Maximum" + JSON.stringify(result));
            })
            .done();
    };
