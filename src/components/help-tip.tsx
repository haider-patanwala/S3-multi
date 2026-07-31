import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/** A "?" that parks a field's instructions in a popover instead of inline prose. */
export function HelpTip({
	label = "What is this?",
	children,
}: {
	label?: string;
	children: ReactNode;
}) {
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						aria-label={label}
						size="icon-xs"
						type="button"
						variant="ghost"
					/>
				}
			>
				<HugeiconsIcon icon={HelpCircleIcon} size={14} strokeWidth={1.5} />
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-72 text-muted-foreground text-xs leading-relaxed"
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}
