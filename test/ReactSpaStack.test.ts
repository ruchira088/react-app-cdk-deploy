import { Match, Template } from "aws-cdk-lib/assertions"
import { App } from "aws-cdk-lib/core"
import { ReactSpaStack, ReactSpaStackProps, SourceS3Resource } from "../src/ReactSpaStack"

const VALID_DOMAIN = "test.ruchij.com"
const VALID_SOURCE: SourceS3Resource = {
  bucketName: "artifact-bucket",
  zipObjectKey: "main/abc1234/client.zip"
}
const STACK_ENV = { env: { account: "123456789012", region: "us-east-1" } }

const buildStack = (
  domain: string = VALID_DOMAIN,
  source: SourceS3Resource = VALID_SOURCE,
  props: Partial<ReactSpaStackProps> = {}
): Template => {
  const app = new App()
  const stack = new ReactSpaStack(app, "TestStack", domain, source, {
    ...STACK_ENV,
    ...props
  })
  return Template.fromStack(stack)
}

describe("ReactSpaStack validation", () => {
  test("rejects domain that does not end with ruchij.com", () => {
    expect(() => buildStack("foo.example.com")).toThrow(
      /Domain must end with ruchij\.com/
    )
  })

  test("accepts the parent domain itself", () => {
    expect(() => buildStack("ruchij.com")).not.toThrow()
  })

  test("accepts deeply-nested subdomains", () => {
    expect(() => buildStack("a.b.c.ruchij.com")).not.toThrow()
  })

  test("rejects source object key that is not a .zip", () => {
    expect(() =>
      buildStack(VALID_DOMAIN, { bucketName: "b", zipObjectKey: "client.tar.gz" })
    ).toThrow(/Source object key must end with \.zip/)
  })

  test("rejects source object key with no extension", () => {
    expect(() =>
      buildStack(VALID_DOMAIN, { bucketName: "b", zipObjectKey: "client" })
    ).toThrow(/Source object key must end with \.zip/)
  })
})

describe("ReactSpaStack S3 bucket", () => {
  test("creates a private bucket named after the domain", () => {
    const template = buildStack()

    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: VALID_DOMAIN,
      AccessControl: "Private"
    })
  })

  test("configures DELETE removal policy and auto-delete by default", () => {
    const template = buildStack()

    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
      Properties: Match.objectLike({
        Tags: Match.arrayWith([
          Match.objectLike({ Key: "aws-cdk:auto-delete-objects", Value: "true" })
        ])
      })
    })
  })

  test("retains the bucket and drops auto-delete when retainContent is set", () => {
    const template = buildStack(VALID_DOMAIN, VALID_SOURCE, { retainContent: true })

    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain"
    })
    template.resourceCountIs("Custom::S3AutoDeleteObjects", 0)
  })

  test("blocks all public access", () => {
    const template = buildStack()

    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    })
  })

  test("denies non-TLS requests via bucket policy", () => {
    const template = buildStack()

    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Action: "s3:*",
            Condition: { Bool: { "aws:SecureTransport": "false" } }
          })
        ])
      })
    })
  })
})

describe("ReactSpaStack CloudFront", () => {
  test("creates an Origin Access Control rather than the legacy OAI", () => {
    const template = buildStack()

    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1)
    template.resourceCountIs("AWS::CloudFront::CloudFrontOriginAccessIdentity", 0)
  })

  test("grants the distribution read access to the bucket via OAC", () => {
    const template = buildStack()

    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: "s3:GetObject",
            Principal: { Service: "cloudfront.amazonaws.com" }
          })
        ])
      })
    })
  })

  test("creates a distribution that redirects HTTP to HTTPS and serves index.html", () => {
    const template = buildStack()

    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: [VALID_DOMAIN],
        DefaultRootObject: "index.html",
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "redirect-to-https"
        })
      })
    })
  })

  test("rewrites both 403 and 404 responses to 200 /index.html with a 5-minute TTL", () => {
    const template = buildStack()

    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          {
            ErrorCode: 403,
            ResponseCode: 200,
            ResponsePagePath: "/index.html",
            ErrorCachingMinTTL: 300
          },
          {
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: "/index.html",
            ErrorCachingMinTTL: 300
          }
        ])
      })
    })
  })
})

describe("ReactSpaStack certificate and DNS", () => {
  test("requests an ACM certificate with DNS validation for the domain", () => {
    const template = buildStack()

    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: VALID_DOMAIN,
      ValidationMethod: "DNS"
    })
  })

  test("creates an A alias record pointing at the distribution", () => {
    const template = buildStack()

    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      Name: `${VALID_DOMAIN}.`,
      AliasTarget: Match.objectLike({
        DNSName: Match.anyValue()
      })
    })
  })
})

describe("ReactSpaStack deployment", () => {
  test("creates a single bucket-deployment custom resource", () => {
    const template = buildStack()
    template.resourceCountIs("Custom::CDKBucketDeployment", 1)
  })

  test("invalidates all paths on the distribution", () => {
    const template = buildStack()

    template.hasResourceProperties("Custom::CDKBucketDeployment", {
      DistributionPaths: ["/*"]
    })
  })

  test("runs the deployment lambda with raised memory", () => {
    const template = buildStack()

    template.hasResourceProperties("AWS::Lambda::Function", {
      MemorySize: 1024
    })
  })
})

describe("ReactSpaStack outputs", () => {
  test("exposes a DomainName output", () => {
    const template = buildStack()

    template.hasOutput("DomainName", {
      Description: "The domain name for the frontend application"
    })
  })
})
