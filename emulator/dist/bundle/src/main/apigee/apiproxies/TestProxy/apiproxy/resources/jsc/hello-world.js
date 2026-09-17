var responseText = response.content;
if (!responseText) responseText = "";

var responseObject = undefined;

try {
  responseObject = JSON.parse(responseText);
} catch(e) {
  print("Could not parse JSON.");
}

var message = context.getVariable("request.queryparam.message");
if (!message)
  message = context.getVariable("propertyset.helloworld.MESSAGE");
if (!message)
  message = "Hello world!";

if (responseObject) {
  responseObject["message"] = message;
  context.setVariable("response.content", JSON.stringify(responseObject));
} else {
  responseText = responseText + " " + message;
  context.setVariable("response.content", responseText);
}