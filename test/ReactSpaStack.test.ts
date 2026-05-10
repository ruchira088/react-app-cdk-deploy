import { Template } from "aws-cdk-lib/assertions"
import { App } from "aws-cdk-lib/core"
import { ReactSpaStack } from "../src/ReactSpaStack"

test("S3 Bucket Created", () => {
  const app = new App()

  const stack = new ReactSpaStack(
    app,
    "MyTestStack",
    "test.ruchij.com",
    {
      bucketName: "test-bucket",
      zipObjectKey: "test-key.zip"
    },
    {
      env: { account: "123456789012", region: "us-east-1" }
    }
  )

  const template = Template.fromStack(stack)

  template.hasResourceProperties("AWS::S3::Bucket", {
    BucketName: "test.ruchij.com"
  })
})
