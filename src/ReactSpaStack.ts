import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib"
import { Construct } from "constructs"
import { BlockPublicAccess, Bucket, BucketAccessControl, IBucket } from "aws-cdk-lib/aws-s3"
import { Distribution, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront"
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53"
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager"
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins"
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets"
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment"

const PARENT_DOMAIN = "ruchij.com"

const ERROR_RESPONSE_TTL = Duration.minutes(5)

export type SourceS3Resource = {
  readonly bucketName: string
  readonly zipObjectKey: string
}

export type ReactSpaStackProps = StackProps & {
  /**
   * Keeps the site bucket and its contents when the stack is destroyed.
   * Intended for production; ephemeral branch environments want the default.
   */
  readonly retainContent?: boolean
}

export class ReactSpaStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    domain: string,
    source: SourceS3Resource,
    props?: ReactSpaStackProps) {
    super(scope, id, props)

    if (!domain.endsWith(PARENT_DOMAIN)) {
      throw new Error(`Domain must end with ${PARENT_DOMAIN}`)
    }

    if (!source.zipObjectKey.endsWith(".zip")) {
      throw new Error(`Source object key must end with .zip`)
    }

    const retainContent = props?.retainContent ?? false

    const s3Bucket = new Bucket(this, "Bucket", {
      bucketName: domain,
      accessControl: BucketAccessControl.PRIVATE,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: retainContent ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !retainContent
    })

    const hostedZone = HostedZone.fromLookup(this, "HostedZone", { domainName: PARENT_DOMAIN })

    const certificate = new Certificate(this, "Certificate", {
      domainName: domain,
      validation: CertificateValidation.fromDns(hostedZone)
    })

    const cloudfrontDistribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(s3Bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      defaultRootObject: "index.html",
      domainNames: [domain],
      certificate,
      errorResponses: [
        // Origin Access Control grants s3:GetObject only, so S3 reports a
        // missing key as 403 rather than 404. Both have to route back to the
        // SPA or client-side deep links break.
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: ERROR_RESPONSE_TTL
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: ERROR_RESPONSE_TTL
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
