import {
	Copy01Icon,
	CopyLinkIcon,
	ViewIcon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { redactSecrets } from "../lib/utils";
import { Button } from "./ui/button";

/**
 * A shell command presented as a small terminal window, so "run this yourself"
 * is legible at a glance. The `dark` class re-themes the block through the
 * existing dark tokens — a terminal is dark in both app themes without a
 * second palette existing anywhere.
 *
 * `secrets` are masked on screen but copied intact: the command has to stay
 * runnable, while the token stays out of screenshots and screen shares. The
 * form that collects these values masks them too — displaying them in the
 * clear here would undo that.
 */
export function TerminalBlock({
	command,
	fileUrl,
	secrets = [],
	onCopied,
}: {
	command: string;
	/** Public URL of the affected file — shown as a second copy action. */
	fileUrl?: string;
	/** Values to mask on screen; the copied text still contains them. */
	secrets?: (string | undefined)[];
	onCopied: (message: string) => void;
}) {
	const [revealed, setRevealed] = useState(false);
	const masked = redactSecrets(command, ...secrets);
	const hasSecret = masked !== command;

	const copy = async (text: string, message: string) => {
		try {
			await navigator.clipboard.writeText(text);
			onCopied(message);
		} catch {
			// Firefox and Safari deny the write outside a user gesture, and any
			// browser denies it without permission. Silence here would read as a
			// successful copy and the operator would paste stale content.
			onCopied("Clipboard blocked by the browser — select the text and copy.");
		}
	};

	return (
		<div className="dark overflow-hidden rounded-lg bg-card text-card-foreground shadow-sm ring-1 ring-foreground/10">
			<div className="flex items-center gap-1.5 border-b bg-muted/40 py-1.5 pr-1.5 pl-3">
				<span aria-hidden className="size-2.5 rounded-full bg-destructive/80" />
				<span aria-hidden className="size-2.5 rounded-full bg-chart-3/80" />
				<span aria-hidden className="size-2.5 rounded-full bg-chart-2/80" />
				<span className="ml-1.5 font-mono text-muted-foreground text-xs">
					bash
				</span>
				<div className="ml-auto flex gap-1">
					{hasSecret ? (
						<Button
							onClick={() => setRevealed((current) => !current)}
							size="xs"
							title={revealed ? "Hide the token" : "Reveal the token"}
							type="button"
							variant="ghost"
						>
							<HugeiconsIcon
								icon={revealed ? ViewOffSlashIcon : ViewIcon}
								size={13}
								strokeWidth={1.5}
							/>
							{revealed ? "Hide" : "Reveal"}
						</Button>
					) : null}
					{fileUrl ? (
						<Button
							onClick={() => copy(fileUrl, "Copied the file URL.")}
							size="xs"
							type="button"
							variant="ghost"
						>
							<HugeiconsIcon icon={CopyLinkIcon} size={13} strokeWidth={1.5} />
							Copy URL
						</Button>
					) : null}
					<Button
						onClick={() => copy(command, "Copied the command.")}
						size="xs"
						type="button"
						variant="ghost"
					>
						<HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.5} />
						Copy command
					</Button>
				</div>
			</div>
			<pre className="overflow-x-auto whitespace-pre p-3 font-mono text-xs leading-relaxed">
				<span aria-hidden className="select-none text-muted-foreground">
					${" "}
				</span>
				{revealed ? command : masked}
			</pre>
		</div>
	);
}
