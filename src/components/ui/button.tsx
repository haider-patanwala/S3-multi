import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"group/button pointer-cursor inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-clip-padding font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"cursor-pointer bg-primary text-primary-foreground hover:bg-primary/85",
				outline:
					"cursor-pointer border-border bg-(--panel-soft) hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground aria-expanded:bg-(--panel-soft) aria-expanded:text-foreground",
				secondary:
					"cursor-pointer bg-secondary text-secondary-foreground hover:bg-[color:rgba(255,255,255,0.06)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
				ghost:
					"cursor-pointer hover:bg-[color:rgba(255,255,255,0.04)] hover:text-foreground aria-expanded:bg-[color:rgba(255,255,255,0.04)] aria-expanded:text-foreground",
				destructive:
					"cursor-pointer bg-destructive/10 text-destructive hover:bg-destructive/18 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
				link: "text-primary underline-offset-4 hover:underline",
				quiet:
					"cursor-pointer border-[color:var(--stroke-strong)] bg-[color:var(--panel-soft)] text-[color:var(--text-soft)] shadow-none hover:border-[color:var(--accent)] hover:bg-[color:var(--accent-soft)] hover:text-[color:var(--accent)] focus-visible:border-[color:var(--accent)] focus-visible:ring-[color:var(--ring)]",
				"quiet-danger":
					"cursor-pointer border-[color:rgba(248,113,113,0.18)] bg-[color:rgba(248,113,113,0.08)] text-[color:var(--danger)] hover:border-[color:var(--danger)] hover:bg-[color:rgba(248,113,113,0.14)] hover:text-[color:var(--danger-strong)] focus-visible:border-[color:var(--danger)] focus-visible:ring-[color:rgba(248,113,113,0.18)]",
			},
			size: {
				default:
					"h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
				xs: "h-6 gap-1 in-data-[slot=button-group]:rounded-lg rounded-[min(var(--radius-md),10px)] px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-7 gap-1 in-data-[slot=button-group]:rounded-lg rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
				quiet:
					"h-9 rounded-full px-3.5 font-semibold text-[0.74rem] tracking-[0.02em]",
				icon: "size-8",
				"icon-xs":
					"size-6 in-data-[slot=button-group]:rounded-lg rounded-[min(var(--radius-md),10px)] [&_svg:not([class*='size-'])]:size-3",
				"icon-sm":
					"size-7 in-data-[slot=button-group]:rounded-lg rounded-[min(var(--radius-md),12px)]",
				"icon-lg": "size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return (
		<ButtonPrimitive
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
