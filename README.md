# connect-agent-assist

A support desk proof of concept on **Amazon Connect**, with the same retrieval-augmented assistant on both
sides of the conversation: the visitor asks it first, and when they escalate to a person the agent sees a
suggested reply drawn from the same manual before typing a word.

Built in a day as a proof of concept, not a product. Infrastructure in OpenTofu, two Lambdas in TypeScript,
two small browser bundles for the customer page and the agent desktop. The suggestion engine is the
support service from [dotnet-rag](https://github.com/twwalsh/dotnet-rag); this repo never calls a model itself.

_Deployment details, URLs and the honest limits are filled in below once the stack is up._
