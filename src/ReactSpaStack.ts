import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib"
import { Construct } from "constructs"
import { BlockPublicAccess, Bucket, BucketAccessControl, IBucket } from "aws-cdk-lib/aws-s3"
import {
  Distribution,
  HttpVersion,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy
} from "aws-cdk-lib/aws-cloudfront"
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53"
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager"
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins"
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets"
import { BucketDeployment, CacheControl, Source } from "aws-cdk-lib/aws-s3-deployment"

const PARENT_DOMAIN = "ruchij.com"

const ERROR_RESPONSE_TTL = Duration.minutes(5)

const DEPLOYMENT_MEMORY_LIMIT = 1024

/**
 * Cache-Control for everything in the artifact except index.html. Bundle file
 * names are content-hashed, so a browser may keep them indefinitely; a new
 * build references new names. The trade-off is that un-hashed root files
 * (favicon.ico, robots.txt, manifest.json) are cached just as long.
 */
const ASSET_CACHE_CONTROL = [CacheControl.maxAge(Duration.days(365)), CacheControl.immutable()]

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
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS
      },
      httpVersion: HttpVersion.HTTP2_AND_3,
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
    const sources = [Source.bucket(sourceBucket, source.zipObjectKey)]

    // The artifact is uploaded in two passes so that index.html — the one file
    // whose name never changes — can carry a different Cache-Control from the
    // hashed bundles it references. Each pass prunes only within its own
    // include/exclude filters, so the two do not delete each other's files.
    const assetsDeployment = new BucketDeployment(this, "Deploy", {
      sources,
      destinationBucket: s3Bucket,
      exclude: ["index.html"],
      cacheControl: ASSET_CACHE_CONTROL,
      memoryLimit: DEPLOYMENT_MEMORY_LIMIT
    })

    // index.html goes last: a browser that fetches the new entrypoint must find
    // every chunk it references already in place. Invalidating from here, once,
    // also guarantees the edge never serves the new index against old assets.
    const indexDeployment = new BucketDeployment(this, "DeployIndex", {
      sources,
      destinationBucket: s3Bucket,
      exclude: ["*"],
      include: ["index.html"],
      cacheControl: [CacheControl.noCache()],
      distribution: cloudfrontDistribution,
      distributionPaths: ["/*"],
      memoryLimit: DEPLOYMENT_MEMORY_LIMIT
    })
    indexDeployment.node.addDependency(assetsDeployment)

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
