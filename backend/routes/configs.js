const router = require("express").Router();

const {trainModel, predictConfig}= require("../Controller/configs")

// 1. Endpoint to START TRAINING (GET is used here, POST is usually better)
router.get("/train", trainModel); 

// 2. Endpoint to GET PREDICTIONS (Requires a POST request with data)
router.post("/predict", predictConfig);

module.exports = router;