# Deploy REST-AI-Interactions
aft ../templates/REST-AI-Interactions.yaml --project $GOOGLE_CLOUD_PROJECT --env $APIGEE_ENV --sa $APIGEE_SA

# Deploy REST-AI-GenerateContent
aft ../templates/REST-AI-GenerateContent.yaml --project $GOOGLE_CLOUD_PROJECT --env $APIGEE_ENV --sa $APIGEE_SA

# Deploy REST-AI-Completions
aft ../templates/REST-AI-Completions.yaml --project $GOOGLE_CLOUD_PROJECT --env $APIGEE_ENV --sa $APIGEE_SA
