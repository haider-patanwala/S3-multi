import { createFileRoute } from "@tanstack/react-router";

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
		<div className="control-panel guide-section">
			<div className="section-label">{label}</div>
			<h3 className="page-subtitle" style={{ marginTop: "0.4rem" }}>
				{title}
			</h3>
			{children}
		</div>
	);
}

function Code({ children }: { children: string }) {
	return (
		<pre className="guide-code">
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
		<div className="guide-step">
			<div className="guide-step-number">{n}</div>
			<div>
				<strong style={{ color: "var(--text)" }}>{title}</strong>
				<div className="page-copy" style={{ marginTop: "0.25rem" }}>
					{children}
				</div>
			</div>
		</div>
	);
}

function Note({ children }: { children: React.ReactNode }) {
	return <div className="guide-note">{children}</div>;
}

function HelpPage() {
	return (
		<div style={{ display: "grid", gap: "1rem" }}>
			<div className="page-header">
				<div className="section-label">Documentation</div>
				<h2 className="page-title">Getting started</h2>
				<p className="page-copy">
					S3 Multi is a browser-based dashboard for managing objects across
					multiple S3-compatible storage providers. All API calls go directly
					from your browser — no backend server is involved.
				</p>
			</div>

			{/* Quick start */}
			<Section label="Overview" title="Quick start">
				<div
					style={{
						display: "grid",
						gap: "0.65rem",
						marginTop: "0.65rem",
					}}
				>
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
				<div
					style={{
						display: "grid",
						gap: "0.65rem",
						marginTop: "0.65rem",
					}}
				>
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
				<div
					style={{
						display: "grid",
						gap: "0.65rem",
						marginTop: "0.65rem",
					}}
				>
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
				<div
					style={{
						display: "grid",
						gap: "0.65rem",
						marginTop: "0.65rem",
					}}
				>
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
				<p className="page-copy" style={{ marginTop: "0.5rem" }}>
					Because this app makes S3 API calls directly from your browser, the
					storage bucket must allow cross-origin requests (CORS). Without CORS,
					the browser will block all requests.
				</p>
				<h4
					className="page-copy"
					style={{
						marginTop: "1rem",
						color: "var(--text)",
						fontWeight: 600,
					}}
				>
					AWS S3 CORS JSON
				</h4>
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

				<h4
					className="page-copy"
					style={{
						marginTop: "1rem",
						color: "var(--text)",
						fontWeight: 600,
					}}
				>
					Cloudflare R2
				</h4>
				<p className="page-copy" style={{ marginTop: "0.25rem" }}>
					Go to R2 → Bucket → Settings → CORS Policy and add the same allowed
					origins, methods, and headers via the dashboard UI.
				</p>

				<h4
					className="page-copy"
					style={{
						marginTop: "1rem",
						color: "var(--text)",
						fontWeight: 600,
					}}
				>
					MinIO
				</h4>
				<p className="page-copy" style={{ marginTop: "0.25rem" }}>
					Use the <code>mc admin config set</code> command or set the{" "}
					<code>MINIO_API_CORS_ALLOW_ORIGIN</code> environment variable. The
					MinIO Console also has a CORS settings page under Settings →
					Configuration.
				</p>
			</Section>

			{/* Using the app */}
			<Section label="Guide" title="Using the app">
				<div
					style={{
						display: "grid",
						gap: "0.65rem",
						marginTop: "0.65rem",
					}}
				>
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
				<div
					style={{
						display: "grid",
						gap: "0.65rem",
						marginTop: "0.65rem",
					}}
				>
					<div className="guide-note">
						<strong style={{ color: "var(--text)" }}>
							Credentials stay local
						</strong>
						<br />
						Your access keys are encrypted and stored in IndexedDB in your
						browser. They are never sent to any server.
					</div>
					<div className="guide-note">
						<strong style={{ color: "var(--text)" }}>No backend</strong>
						<br />
						All S3 API calls are made directly from your browser to the storage
						provider. There is no intermediary server.
					</div>
					<div className="guide-note">
						<strong style={{ color: "var(--text)" }}>
							Use scoped IAM policies
						</strong>
						<br />
						For production use, create IAM credentials with the minimum required
						permissions scoped to specific buckets rather than using full admin
						access.
					</div>
				</div>
			</Section>
		</div>
	);
}
