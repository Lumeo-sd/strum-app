#!/bin/bash
# Deploy the fixed tuya-local.js to the energy-controller
scp new-tuya-local.js hb-service@192.168.0.178:/tmp/tuya-local.js
ssh hb-service@192.168.0.178 "sudo cp /tmp/tuya-local.js /opt/energy-controller/lib/tuya-local.js && sudo systemctl restart energy-controller"
echo "Done"
