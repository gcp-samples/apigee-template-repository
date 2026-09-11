# Deploy REST-AI-Interactions
aft ../templates/REST-AI-Interactions.yaml --project $GOOGLE_CLOUD_PROJECT --env $APIGEE_ENV --sa $APIGEE_SA

# Deploy REST-AI-GenerateContent
aft ../templates/REST-AI-GenerateContent.yaml --project $GOOGLE_CLOUD_PROJECT --env $APIGEE_ENV --sa $APIGEE_SA

# Deploy REST-AI-Messages
aft ../templates/REST-AI-Messages.yaml --project $GOOGLE_CLOUD_PROJECT --env $APIGEE_ENV --sa $APIGEE_SA

# Deploy REST-AI-Completions
aft ../templates/REST-AI-Completions.yaml --project $GOOGLE_CLOUD_PROJECT --env $APIGEE_ENV --sa $APIGEE_SA
aft tests/products/ai-starter-package.yaml --project $GOOGLE_CLOUD_PROJECT --environment $APIGEE_ENV
aft tests/products/ai-premium-package.yaml --project $GOOGLE_CLOUD_PROJECT --environment $APIGEE_ENV
aft tests/users/test.yaml --project $GOOGLE_CLOUD_PROJECT

# Deploy REST-AI-Embeddings
aft ../templates/REST-AI-Embeddings.yaml --project $GOOGLE_CLOUD_PROJECT --env $APIGEE_ENV --sa $APIGEE_SA

# Deploy REST-AI-Images
aft ../templates/REST-AI-Images.yaml --project $GOOGLE_CLOUD_PROJECT --env $APIGEE_ENV --sa $APIGEE_SA
