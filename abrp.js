module.exports = function(RED) {

    const fs = require('fs');
    const path = require('path');
    const https = require('https');
    //const request = require('sync-request');

    function AbrpconfigNode(config) {
        RED.nodes.createNode(this, config);
        this.usertoken = config.usertoken;
        this.carmodel = config.carmodel;
        this.apikey = config.apikey;
        this.apiurl = config.apiurl;
        var nodeContext = this.context();
    }

    function AbrpSendTlm(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        this.abrpconfig = RED.nodes.getNode(config.abrpconfig);

        //this.usertoken = RED.nodes.getNode(config.usertoken);
        //this.carmodel = RED.nodes.getNode(config.carmodel);
        //this.apikey = RED.nodes.getNode(config.apikey);
        //this.apiurl = RED.nodes.getNode(config.apiurl);
        var nodeContext = this.context();
        var throttleKey = this.abrpconfig.apiurl + '#' + this.abrpconfig.usertoken;

        this.on('input', async function(msg) {

            node.status({
                fill: 'grey',
                shape: 'ring',
                text: "Called..."
            });
            var tlm = msg.payload;

            // check if it's a real object, not an array and not null (null is also an object)
            if (typeof msg.payload === 'object' && !Array.isArray(msg.payload) && msg.payload !== null) {
                var tlm = {
                    vars: {},
                    discarded: {}
                };
                for (const [key, value] of Object.entries(msg.payload)) {
                    //console.log(`${key}: ${value}`);
                    switch (key) {
                        case 'utc': // High Priority (UTC Epoch Timestamp in seconds)
                            // Let's make sure it's not too much in the futur
                            if (value < ((new Date()).getTime() / 1000 + 300)) {
                                tlm.vars[key] = value;
                            } else {
                                tlm.discarded[key] = value;
                                RED.log.warn(`'${key}' has an invalid value`);
                            }
                            break;
                        case 'soc': // High Priority (%, the value displayed on dashboard, not from BMS)
                            // Let's make sure it's normal
                            if (value > -5 && value < 110) {
                                tlm.vars[key] = value;
                            } else {
                                tlm.discarded[key] = value;
                                RED.log.warn(`'${key}' has an invalid value`);
                            }
                            break;
                        case 'power': // High Priority (kW, positive during use, negative during charge)
                            // Let's make sure it's normal
                            if (value > -1000 && value < 2000) { // Yes, 1MW charging and 2700HP
                                tlm.vars[key] = value;
                            } else {
                                tlm.discarded[key] = value;
                                RED.log.warn(`'${key}' has an invalid value`);
                            }
                            break;
                        case 'speed': // High Priority
                        case 'lat': // High Priority
                        case 'lon': // High Priority
                        case 'is_charging': // High Priority
                        case 'is_dcfc': // High Priority
                        case 'is_parked': // High Priority
                        case 'capacity': // 
                        case 'soe':
                        case 'soh':
                        case 'heading':
                        case 'elevation':
                        case 'ext_temp':
                        case 'batt_temp':
                        case 'voltage':
                        case 'current':
                        case 'odometer':
                        case 'est_battery_range':
                        case 'hvac_power':
                        case 'hvac_setpoint':
                        case 'cabin_temp':
                        case 'tire_pressure_fl':
                        case 'tire_pressure_fr':
                        case 'tire_pressure_rl':
                        case 'tire_pressure_rr':
                            tlm.vars[key] = value;
                            break;
                        default:
                            tlm.discarded[key] = value;
                            RED.log.warn(`sendtlm input payload contained unknown key '${key}'`);
                    }
                }
                if (!tlm.vars.hasOwnProperty('utc')) {
                    tlm.vars['utc'] = Math.floor((new Date()).getTime() / 1000);
                }
                /*
                 
                 */

                try {
                    https.get(
                        this.abrpconfig.apiurl + 'tlm/send?api_key=' + this.abrpconfig.apikey + '&token=' + this.abrpconfig.usertoken + '&tlm=' + encodeURI(JSON.stringify(tlm.vars)), {
                            timeout: 3000,
                            method: 'POST'
                        },
                        (getres) => {
                            let data = '';
                            // A chunk of data has been received.
                            getres.on('data', (chunk) => {
                                data += chunk;
                            });
                            // The whole response has been received.
                            getres.on('end', () => {
                                try {
                                    const jsonData = JSON.parse(data);
                                    msg.payload = jsonData;
                                    if (jsonData.status == 'ok') {
                                        RED.log.debug("sendtlm jsonData.status == 'ok'");
                                        node.status({
                                            fill: 'green',
                                            shape: 'dot',
                                            text: jsonData.status
                                        });
                                        node.send({
                                            payload: {
                                                tlm: tlm,
                                                result: jsonData
                                            }
                                        });
                                    } else {
                                        RED.log.error("sendtlm jsonData.status != 'ok'", jsonData);
                                        node.status({
                                            fill: 'red',
                                            shape: 'dot',
                                            text: jsonData.status
                                        });
                                        node.send(msg);
                                    }
                                } catch (err) {
                                    RED.log.error("sendtlm jsonData decode error", jsonData);
                                    node.status({
                                        fill: 'red',
                                        shape: 'dot',
                                        text: err
                                    });
                                    node.send(msg);
                                }
                            });
                        });

                } catch (err) {
                    node.status({
                        fill: 'red',
                        shape: 'dot',
                        text: err
                    });
                    node.send({
                        payload: err,
                    });
                }

            } else {
                node.status({
                    fill: 'red',
                    shape: 'dot',
                    text: 'Incorrect msg.payload given'
                });
                node.send({
                    payload: msg.payload,
                });
            }

        });
    }

    function writeAbrpDataFile(path, data) {
        fs.writeFile(path, JSON.stringify(data, null, 2), (err) => {
            if (err) {
                RED.log.error("Failed to write file: " + err.message);
            } else {
                RED.log.info("Wrote file !");
            }
        });
    }
    // Local Route to get/refresh carmodels_list from given apiurl
    // Does not use config node for apiurl in case one changes it from the node before saving
    RED.httpAdmin.get('/_abrp/get_carmodels_list/:refresh/:apikey/:apiurl', function(req, res) {
        var abrpdatafile = path.join(RED.settings.userDir, 'abrpdata.json');
        let refreshlist = req.params.refresh == 'true' ? true : false;
        let apiurl = req.params.apiurl
        let apikey = req.params.apikey
        let abrpdata = false;

        try {
            // Read the file content synchronously
            const data = fs.readFileSync(abrpdatafile, 'utf8');
            try {
                // Parse the JSON string to an object
                abrpdata = JSON.parse(data);
            } catch (parseErr) {
                // Handle JSON parsing errors
                RED.log.error('Error parsing JSON:', parseErr);
            }
        } catch (err) {
            if (err.code === 'ENOENT') {
                RED.log.warn("Failed to read file: " + err.message + " ... might create it");
                abrpdata = {};
                //writeAbrpDataFile(abrpdatafile,abrpdata);
            } else {
                RED.log.error("Unhandled error while trying to read file: " + err.message);
            }
        }

        // ensure abrpdata has carmodels_list
        if (!abrpdata.hasOwnProperty('carmodels_lists')) {
            abrpdata.carmodels_lists = {};
            // Don't, next check should trigger adding info anyways
            //writeAbrpDataFile(abrpdatafile,abrpdata);
        }
        if (!abrpdata.carmodels_lists.hasOwnProperty(apiurl) || refreshlist) {

            let newData;
            RED.log.debug("Car lists from " + apiurl + " don't exist, or refresh requested");

            // This is async, and it's a pain sometimes
            https.get(apiurl + 'tlm/get_carmodels_list?api_key=' + apikey, (getres) => {
                let data = '';
                // A chunk of data has been received.
                getres.on('data', (chunk) => {
                    data += chunk;
                });
                // The whole response has been received.
                getres.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        if (jsonData.status == 'ok') {
                            RED.log.debug("jsonData.status == 'ok'");
                            const transformedCarList = jsonData.result.map(obj => {
                                const key = Object.keys(obj)[0];
                                const value = obj[key];
                                return {
                                    value,
                                    label: key
                                };
                            });
                            abrpdata.carmodels_lists[apiurl] = transformedCarList;
                            writeAbrpDataFile(abrpdatafile, abrpdata);
                            res.json(abrpdata.carmodels_lists[apiurl]);
                        } else {
                            RED.log.error("jsonData.status != 'ok'", jsonData);
                        }
                        //console.log(jsonData);
                    } catch (err) {
                        console.error('Error parsing JSON:', err);
                        res.status(500).json({
                            error: "Failed Parsing Json, check API Base URL"
                        });
                    }
                });

            }).on('error', (err) => {
                console.error('Error:', err);
                res.status(500).json({
                    error: err
                });
            });

        } else {
            RED.log.debug("Car lists from " + apiurl + " exists, and no refresh requested");
            res.json(abrpdata.carmodels_lists[apiurl]);
        }
    });

    RED.nodes.registerType("abrpconfig", AbrpconfigNode);
    RED.nodes.registerType("abrpsendtlm", AbrpSendTlm);
}
