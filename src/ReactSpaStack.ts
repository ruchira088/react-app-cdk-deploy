import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib"
import { Construct } from "constructs"
import { Bucket, BucketAccessControl, IBucket } from "aws-cdk-lib/aws-s3"
import { Distribution, OriginAccessIdentity, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront"
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53"
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager"
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins"
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets"
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment"

const PARENT_DOMAIN = "ruchij.com"

export type SourceS3Resource = {
  readonly bucketName: string
  readonly zipObjectKey: string
}

export class ReactSpaStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    domain: string,
    source: SourceS3Resource,
    props?: StackProps) {
    super(scope, id, props)

    if (!domain.endsWith(PARENT_DOMAIN)) {
      throw new Error(`Domain must end with ${PARENT_DOMAIN}`)
    }

    if (!source.zipObjectKey.endsWith(".zip")) {
      throw new Error(`Source object key must end with .zip`)
    }

    const s3Bucket = new Bucket(this, "Bucket", {
      bucketName: domain,
      accessControl: BucketAccessControl.PRIVATE,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    })

    const originAccessIdentity = new OriginAccessIdentity(this, "OriginAccessIdentity")
    s3Bucket.grantRead(originAccessIdentity)

    const hostedZone = HostedZone.fromLookup(this, "HostedZone", { domainName: PARENT_DOMAIN })

    const certificate = new Certificate(this, "Certificate", {
      domainName: domain,
      validation: CertificateValidation.fromDns(hostedZone)
    })

    const cloudfrontDistribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessIdentity(s3Bucket, { originAccessIdentity }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      defaultRootObject: "index.html",
      domainNames: [domain],
      certificate,
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(5)
        }
      ]
    })

    const sourceBucket: IBucket = Bucket.fromBucketName(this, "SourceBucket", source.bucketName)

    new BucketDeployment(this, "Deploy", {
      sources: [Source.bucket(sourceBucket, source.zipObjectKey)],
      destinationBucket: s3Bucket,
      distribution: cloudfrontDistribution,
      distributionPaths: ["/*"],
      memoryLimit: 1024
    })

    const aliasRecord = new ARecord(this, "AliasRecord", {
      recordName: domain,
      zone: hostedZone,
      target: RecordTarget.fromAlias(new CloudFrontTarget(cloudfrontDistribution))
    })

    new CfnOutput(
      this,
      "DomainName",
      {
        value: aliasRecord.domainName,
        description: "The domain name for the frontend application",
      }
    )
  }
}
