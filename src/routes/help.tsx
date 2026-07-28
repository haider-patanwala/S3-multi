import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/help")({
	component: HelpPage,
});

function Section({
	label,
	title,
	children,
}: {
	label: string;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardDescription className="font-medium text-xs uppercase tracking-wider">
					{label}
				</CardDescription>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">{children}</CardContent>
		</Card>
	);
}

function Code({ children }: { children: string }) {
	return (
		<pre className="overflow-auto rounded-md border bg-muted p-3 font-mono text-muted-foreground text-xs leading-relaxed">
			<code>{children}</code>
		</pre>
	);
}

function Step({
	n,
	title,
	children,
}: {
	n: number;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex gap-3">
			<div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs">
				{n}
			</div>
			<div>
				<strong className="font-medium text-sm">{title}</strong>
				<div className="mt-1 text-muted-foreground text-sm">{children}</div>
			</div>
		</div>
	);
}

function Note({ children }: { children: React.ReactNode }) {
	return (
		<Alert>
			<AlertDescription>{children}</AlertDescription>
		</Alert>
	);
}

function HelpPage() {
	return (
		<div className="grid gap-4">
			<p className="max-w-3xl text-muted-foreground text-sm">
				S3 Multi manages objects across multiple S3-compatible providers. Every
				API call goes straight from your browser to the provider — there is no
				backend.
			</p>

			{/* Quick start */}
			<Section label="Overview" title="Quick start">
				<div className="grid gap-3">
					<Step n={1} title="Create a provider">
						Go to <strong>Providers</strong> and add your S3-compatible
						credentials (AWS, Cloudflare R2, MinIO, etc.).
					</Step>
					<Step n={2} title="Browse buckets">
						Switch to the <strong>Browser</strong> tab. Select a bucket and
						navigate your objects.
					</Step>
					<Step n={3} title="Upload & download">
						Drag files into the browser to upload, or click the download button
						on any object. Track progress in <strong>Transfers</strong>.
					</Step>
				</div>
			</Section>

			{/* AWS S3 */}
			<Section label="Provider setup" title="AWS S3">
				<div className="grid gap-3">
					<Step n={1} title="Create an IAM user">
						In the AWS Console, go to IAM → Users → Create user. Enable
						programmatic access.
					</Step>
					<Step n={2} title="Attach a policy">
						Attach <code>AmazonS3FullAccess</code> for quick setup, or use a
						scoped policy:
					</Step>
					<Code>
						{`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListAllMyBuckets"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}`}
					</Code>
					<Step n={3} title="Copy credentials">
						Copy the <strong>Access Key ID</strong> and{" "}
						<strong>Secret Access Key</strong> into the provider form.
					</Step>
					<Step n={4} title="Configure CORS on the bucket">
						In S3 → Bucket → Permissions → CORS, add a configuration (see CORS
						section below).
					</Step>
					<Note>
						Set the <strong>Region</strong> to match your bucket (e.g.{" "}
						<code>us-east-1</code>). Leave the endpoint blank for standard AWS
						S3.
					</Note>
				</div>
			</Section>

			{/* Cloudflare R2 */}
			<Section label="Provider setup" title="Cloudflare R2">
				<div className="grid gap-3">
					<Step n={1} title="Create an R2 API token">
						In the Cloudflare dashboard, go to R2 → Manage R2 API Tokens →
						Create API Token.
					</Step>
					<Step n={2} title="Set permissions">
						Grant <strong>Object Read & Write</strong> permissions. Scope to
						specific buckets if desired.
					</Step>
					<Step n={3} title="Copy credentials">
						Copy the <strong>Access Key ID</strong> and{" "}
						<strong>Secret Access Key</strong>.
					</Step>
					<Step n={4} title="Set the endpoint">
						Use the format:{" "}
						<code>{"https://<account-id>.r2.cloudflarestorage.com"}</code>. Find
						your Account ID on the R2 overview page.
					</Step>
					<Note>
						R2's <code>ListBuckets</code> may not work from the browser. Add
						your bucket names manually in the provider form using the{" "}
						<strong>Pre-defined buckets</strong> field.
					</Note>
					<Step n={5} title="Configure CORS">
						In R2 → Bucket Settings → CORS Policy, add the allowed origins and
						methods (see CORS section below).
					</Step>
				</div>
			</Section>

			{/* Custom / MinIO */}
			<Section label="Provider setup" title="Custom S3 (MinIO, etc.)">
				<div className="grid gap-3">
					<Step n={1} title="Enter endpoint URL">
						Point to your S3-compatible endpoint, e.g.{" "}
						<code>https://minio.example.com</code> or{" "}
						<code>http://localhost:9000</code>.
					</Step>
					<Step n={2} title="Enter credentials">
						Use the access key and secret key configured in your S3-compatible
						service.
					</Step>
					<Step n={3} title="Enable path-style">
						Toggle <strong>Force path style</strong> on. Most non-AWS services
						(MinIO, Ceph, etc.) require path-style addressing instead of
						virtual-hosted-style.
					</Step>
					<Note>
						For MinIO, set CORS via the <code>mc</code> CLI or environment
						variables. See the CORS section below for the required headers and
						methods.
					</Note>
				</div>
			</Section>

			{/* CORS */}
			<Section label="Configuration" title="CORS configuration">
				<p className="text-muted-foreground text-sm">
					Because this app makes S3 API calls directly from your browser, the
					storage bucket must allow cross-origin requests (CORS). Without CORS,
					the browser will block all requests.
				</p>
				<h4 className="mt-4 font-medium text-sm">AWS S3 CORS JSON</h4>
				<Code>
					{`[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": [
      "ETag",
      "x-amz-request-id",
      "x-amz-id-2",
      "Content-Length",
      "Content-Type"
    ],
    "MaxAgeSeconds": 3600
  }
]`}
				</Code>
				<Note>
					For production, replace <code>"*"</code> in AllowedOrigins with your
					actual domain (e.g. <code>"https://your-app.com"</code>).
				</Note>

				<h4 className="mt-4 font-medium text-sm">Cloudflare R2</h4>
				<p className="text-muted-foreground text-sm">
					Go to R2 → Bucket → Settings → CORS Policy and add the same allowed
					origins, methods, and headers via the dashboard UI.
				</p>

				<h4 className="mt-4 font-medium text-sm">MinIO</h4>
				<p className="text-muted-foreground text-sm">
					Use the <code>mc admin config set</code> command or set the{" "}
					<code>MINIO_API_CORS_ALLOW_ORIGIN</code> environment variable. The
					MinIO Console also has a CORS settings page under Settings →
					Configuration.
				</p>
			</Section>

			{/* CDN cache purging */}
			<Section label="Configuration" title="Purging the CDN cache">
				<p className="text-muted-foreground text-sm">
					Editing a file updates the bucket immediately, but a CDN in front of
					that bucket can keep serving the old copy to your visitors until it is
					purged. How you purge depends on the provider — and the difference is
					not this app's choice.
				</p>

				<h4 className="mt-4 font-medium text-base">
					AWS S3 + CloudFront — purges from the app
				</h4>
				<p className="text-muted-foreground text-sm">
					The CloudFront API allows browser calls (it returns{" "}
					<code>Access-Control-Allow-Origin: *</code>), so this works in-app
					with no extra setup. Open a file preview →{" "}
					<strong>Purge cache</strong>, paste your Distribution ID, then{" "}
					<strong>Save &amp; purge now</strong>. Saving an edited file also
					purges that file automatically.
				</p>
				<p className="text-muted-foreground text-sm">
					The access key for this provider needs the{" "}
					<code>cloudfront:CreateInvalidation</code> IAM permission:
				</p>
				<Code>{`{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "cloudfront:CreateInvalidation",
    "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
  }]
}`}</Code>
				<p className="text-muted-foreground text-sm">
					The dialog also shows the equivalent AWS CLI command if you would
					rather not grant that permission to a browser-held key:
				</p>
				<Code>{`aws cloudfront create-invalidation \\
  --distribution-id 'E1A2B3C4D5E6F7' \\
  --paths '/docs/readme.md'`}</Code>
				<Note>
					The first 1,000 invalidation paths per month are free; after that AWS
					charges per path. <code>/*</code> counts as a single path, so a
					wildcard purge is cheaper but blunter. Invalidations are asynchronous
					— acceptance is not completion, and propagation takes a few minutes.
				</Note>

				<h4 className="mt-4 font-medium text-base">
					Cloudflare R2 — copy a command, run it yourself
				</h4>
				<p className="text-muted-foreground text-sm">
					Cloudflare's API cannot be called from a browser. It sends no CORS
					headers on any endpoint and answers preflight requests with{" "}
					<code>405</code>, and because the purge request carries an{" "}
					<code>Authorization</code> header a preflight is mandatory. No setting
					in the Cloudflare dashboard changes this —{" "}
					<code>api.cloudflare.com</code> is on a zone Cloudflare owns, so
					Transform Rules and Workers in your account cannot touch it. It is a
					deliberate stance: a browser-callable credential API would let any XSS
					steal your token.
				</p>
				<p className="text-muted-foreground text-sm">
					So instead of failing, the app builds the exact command for you. Open
					a file preview → <strong>Purge cache</strong>, fill in the fields,
					then use <strong>Copy</strong> and paste it into a terminal:
				</p>
				<div className="grid gap-3">
					<Step n={1} title="Zone ID">
						Cloudflare dashboard → select your domain → Overview → API panel on
						the right.
					</Step>
					<Step n={2} title="API token">
						My Profile → API Tokens → Create Token → Custom token with{" "}
						<code>Zone · Cache Purge</code> permission, scoped to this zone
						only. Do not reuse a Global API Key.
					</Step>
					<Step n={3} title="Public CDN URL (recommended)">
						The domain your visitors actually load these objects from, e.g.{" "}
						<code>https://cdn.example.com</code>. Cloudflare can only purge a
						single file if it knows that file's public URL — without it the
						command falls back to purging the entire zone.
					</Step>
					<Step n={4} title="Copy and run">
						The dialog offers one command for the open file and one for the
						whole zone. Cloudflare replies <code>{'"success": true'}</code> when
						the purge is accepted.
					</Step>
				</div>
				<Code>{`curl -X POST 'https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/purge_cache' \\
  -H 'Authorization: Bearer <API_TOKEN>' \\
  -H 'Content-Type: application/json' \\
  --data '{"files":["https://cdn.example.com/docs/readme.md"]}'`}</Code>
				<Note>
					The command contains your API token in plain text. Prefer a token
					scoped to <code>Zone · Cache Purge</code> on one zone, and clear your
					shell history afterwards if that matters in your environment. Nothing
					is transmitted when the command is generated — it is built locally and
					only runs when you run it.
				</Note>
				<Note>
					Purging is avoidable: if you set a short <code>Cache-Control</code>{" "}
					(for example <code>max-age=60, must-revalidate</code>) on files you
					edit often, the edge revalidates on its own. Editing a file in this
					app preserves whatever <code>Cache-Control</code> the object already
					has.
				</Note>
			</Section>

			{/* Using the app */}
			<Section label="Guide" title="Using the app">
				<div className="grid gap-3">
					<Step n={1} title="Creating & testing a provider">
						Fill in the provider form and click <strong>Test connection</strong>{" "}
						to verify your credentials and CORS setup before saving.
					</Step>
					<Step n={2} title="Bucket management">
						If your provider supports <code>ListBuckets</code>, buckets appear
						automatically. Otherwise, add bucket names manually in the{" "}
						<strong>Pre-defined buckets</strong> field of the provider form.
					</Step>
					<Step n={3} title="Browsing objects">
						Click a bucket to browse its contents. Use the breadcrumb trail to
						navigate. Click a folder to enter it, or click an object name to
						preview it.
					</Step>
					<Step n={4} title="Creating folders">
						Click <strong>New folder</strong> in the toolbar. Enter a name — a
						trailing slash is added automatically.
					</Step>
					<Step n={5} title="Uploading files">
						Drag and drop files onto the browser area, or click the{" "}
						<strong>Upload</strong> button and select files. Multiple files can
						be uploaded at once.
					</Step>
					<Step n={6} title="Downloading files">
						Click the download button on any object row. The file downloads
						directly from S3 through your browser.
					</Step>
					<Step n={7} title="Transfer queue">
						The <strong>Transfers</strong> tab shows all active and completed
						uploads and downloads with progress bars, speed, and status.
					</Step>
				</div>
			</Section>

			{/* Security */}
			<Section label="Security" title="Security notes">
				<div className="grid gap-3">
					<Note>
						<strong className="font-medium text-foreground">
							Credentials stay local
						</strong>
						<br />
						Your access keys are encrypted and stored in IndexedDB in your
						browser. They are never sent to any server.
					</Note>
					<Note>
						<strong className="font-medium text-foreground">No backend</strong>
						<br />
						All S3 API calls are made directly from your browser to the storage
						provider. There is no intermediary server.
					</Note>
					<Note>
						<strong className="font-medium text-foreground">
							Use scoped IAM policies
						</strong>
						<br />
						For production use, create IAM credentials with the minimum required
						permissions scoped to specific buckets rather than using full admin
						access.
					</Note>
				</div>
			</Section>
		</div>
	);
}
