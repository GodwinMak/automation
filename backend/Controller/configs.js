// backend/Controller/configs.js

const db = require('../Models'); 
const { Sequelize } = require('sequelize');
const axios = require('axios'); // Ensure axios is installed: npm install axios

// Constants
const configurationdata = db.configurationdata; 
const PYTHON_ML_SERVICE_URL = 'http://localhost:5000';

/**
 * Fetches all complete configuration records from the database.
 * @returns {Promise<Array>} A promise that resolves to an array of training data objects.
 */
const fetchAllTrainingDataFromDB = async () => {
    console.log("Fetching all complete training datasets from database...");
    
    try {
        const trainingData = await configurationdata.findAll({
            where: {
                // Sequelize literal to ensure both arrays are populated
                [Sequelize.Op.and]: [
                    Sequelize.literal('JSON_LENGTH(bng_pe_configurations) > 0'),
                    Sequelize.literal('JSON_LENGTH(nbr_switch_configurations) > 0')
                ]
            },
            attributes: ['bng_pe_configurations', 'nbr_switch_configurations', 'customerinfo_id'],
            raw: true, 
        });

        console.log(`Successfully fetched ${trainingData.length} records.`);
        return trainingData;

    } catch (error) {
        console.error("Sequelize Error in fetchAllTrainingDataFromDB:", error.message);
        throw new Error("Database query failed while fetching training data.");
    }
};

/**
 * API Handler to trigger the model training in the Python ML service.
 */
exports.trainModel = async (req, res) => {
    // 1. Fetch the data from the local database
    let trainingData;
    try {
        trainingData = await fetchAllTrainingDataFromDB();
    } catch (dbError) {
        return res.status(500).json({ message: dbError.message });
    }

    if (trainingData.length === 0) {
        return res.status(404).json({ message: "No complete training data found to send to Python." });
    }
    
    // 2. Send the data to the Python /train endpoint
    try {
        console.log(`Sending ${trainingData.length} records to Python service for training...`);
        
        const response = await axios.post(
            `${PYTHON_ML_SERVICE_URL}/train`, 
            trainingData, 
            { timeout: 60000 } // 60s timeout for training
        ); 
        
        res.json({ message: "Training initiated.", python_response: response.data });
    } catch (error) {
        // Handle network or Python server errors
        const errorMessage = error.response ? error.response.data.message : error.message;
        res.status(500).json({ message: "Failed to train Python model.", error: errorMessage });
    }
};


/**
 * API Handler to get configuration predictions from the Python ML service.
 */

const BNG_TEMPLATE = [
    // Note: {unit_id} should be 0 or 1 based on whether it is a tagged or untagged unit.
    "set interfaces {bng_ps_interface} anchor-point lt-0/0/0", 
    "set interfaces {bng_ps_interface} unit 0 encapsulation ethernet-ccc", 
    'set interfaces {bng_ps_interface} unit {unit_id} description "{cat=DIA|nbr={nbr_switch_name} {nbr_interface}|Customer={customer_name}|cid={customer_id}|Mbps={bandwidth}}"', 
    // Uses ML predicted value: policer_name
    "set interfaces {bng_ps_interface} unit {unit_id} layer2-policer input-policer {policer_name}", 
    "set interfaces {bng_ps_interface} unit {unit_id} layer2-policer output-policer {policer_name}", 
    "set interfaces {bng_ps_interface} unit {unit_id} family inet address {bng_l3_address}", 
    "set interfaces {bng_ps_interface} unit {unit_id} family inet6 dad-disable", 
    // Uses ML predicted value: virtual_circuit_id & interface_mtu
    "set protocols l2circuit neighbor {remote_peer_ip} interface {bng_ps_interface}.0 virtual-circuit-id {virtual_circuit_id}", 
    "set protocols l2circuit neighbor {remote_peer_ip} interface {bng_ps_interface}.0 control-word", 
    "set protocols l2circuit neighbor {remote_peer_ip} interface {bng_ps_interface}.0 mtu {interface_mtu}", 
    "set protocols l2circuit neighbor {remote_peer_ip} interface {bng_ps_interface}.0 pseudowire-status-tlv"
];

const NBR_SWITCH_TEMPLATE = [
    // Uses customer data for interface and description
    'set interfaces {nbr_interface} description "{cat=DIA|nwrk=LTZ|nbr={bng_name} {bng_ps_interface}|Customer={customer_name}|cid={customer_id}|Mbps={bandwidth}}"', 
    // Uses ML predicted value: virtual_circuit_id & interface_mtu
    "set protocols l2circuit neighbor {remote_peer_ip} interface {nbr_interface}.0 virtual-circuit-id {virtual_circuit_id}", 
    "set protocols l2circuit neighbor {remote_peer_ip} interface {nbr_interface}.0 control-word", 
    "set protocols l2circuit neighbor {remote_peer_ip} interface {nbr_interface}.0 mtu {interface_mtu}", 
    "set protocols l2circuit neighbor {remote_peer_ip} interface {nbr_interface}.0 pseudowire-status-tlv", 
    "set protocols l2circuit neighbor {remote_peer_ip} interface {nbr_interface}.0 revert-time 15", 
    "set protocols l2circuit neighbor {remote_peer_ip} interface {nbr_interface}.0 backup-neighbor {backup_neighbor_ip} virtual-circuit-id {virtual_circuit_id}"
];

/**
 * Utility function to render a template array into CLI commands.
 * @param {string[]} template - Array of command strings with placeholders.
 * @param {object} data - Object containing values for the placeholders.
 * @returns {string[]} Array of final CLI commands.
 */
function renderConfig(template, data) {
    return template.map(line => {
        return line.replace(/\{(\w+)\}/g, (match, key) => {
            // Use the value from the data object, or the original placeholder if key is missing
            return data[key] !== undefined ? data[key] : match; 
        });
    });
}
exports.predictConfig = async (req, res) => {
    const { 
        bandwidth, 
        vlan_id, 
        ...otherConfigData 
    } = req.body; 

    // --- Validation ---
    if (!bandwidth || typeof bandwidth !== 'number' || bandwidth <= 0) {
        return res.status(400).json({ error: "Invalid or missing 'bandwidth' for prediction." });
    }
    if (vlan_id === undefined || typeof vlan_id !== 'number' || vlan_id < 0 || vlan_id > 4094) {
         return res.status(400).json({ error: "Missing or invalid 'vlan_id'." });
    }
    
    // --- Logic for unit_id ---
    let calculatedUnitId = (vlan_id === 0) ? 1 : vlan_id; 

    try {
        // 1. CALL ML SERVICE TO GET PREDICTED VARIABLES
        const pythonResponse = await axios.post(`${PYTHON_ML_SERVICE_URL}/predict`, {
            bandwidth: bandwidth 
        });
        const predicted = pythonResponse.data;

        // 2. MERGE ALL DATA
        const allConfigData = {
            bandwidth, 
            vlan_id,
            ...otherConfigData, 
            unit_id: calculatedUnitId, 
            ...predicted, 
        };

        // 3. DYNAMICALLY BUILD BNG TEMPLATE ARRAY
        let finalBngTemplate = [...BNG_TEMPLATE];
        
        // Find the index of the description line to insert the vlan-id line right after it
        const descLineIndex = finalBngTemplate.findIndex(line => line.includes('description'));

        if (vlan_id !== 0 && descLineIndex !== -1) {
            // Insert the VLAN ID configuration line for tagged services
            const vlanLine = "set interfaces {bng_ps_interface} unit {unit_id} vlan-id {vlan_id}";
            finalBngTemplate.splice(descLineIndex + 1, 0, vlanLine);
        }
        

        // 4. GENERATE FINAL CLI COMMANDS
        const bng_config = renderConfig(finalBngTemplate, allConfigData);
        const nbr_config = renderConfig(NBR_SWITCH_TEMPLATE, allConfigData);

        // 5. SEND FINAL CONFIGURATION
        res.json({
            message: "Predicted configuration generated successfully.",
            bng_pe_configurations: bng_config,
            nbr_switch_configurations: nbr_config
        });
        
    } catch (error) {
        // ... (Error handling remains the same) ...
        console.error("Error generating configuration:", error.response ? error.response.data : error.message);
        const mlError = error.response && error.response.data.message ? error.response.data.message : 'Unknown error during prediction.';
        res.status(500).json({ 
            error: "Failed to generate final configuration commands.",
            details: mlError
        });
    }
};