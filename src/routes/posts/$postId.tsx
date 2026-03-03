import {
	useQueryErrorResetBoundary,
	useSuspenseQuery,
} from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
	createFileRoute,
	ErrorComponent,
	useRouter,
} from "@tanstack/react-router";
import * as React from "react";
import { postQueryOptions } from "../../postQueryOptions";
import { PostNotFoundError } from "../../posts";

export const Route = createFileRoute("/posts/$postId")({
	component: PostComponent,
	errorComponent: PostErrorComponent,
	loader: ({ context: { queryClient }, params: { postId } }) => {
		return queryClient.ensureQueryData(postQueryOptions(postId));
	},
});

export function PostErrorComponent({ error }: ErrorComponentProps) {
	const router = useRouter();

	const queryErrorResetBoundary = useQueryErrorResetBoundary();

	React.useEffect(() => {
		queryErrorResetBoundary.reset();
	}, [queryErrorResetBoundary]);

	if (error instanceof PostNotFoundError) {
		return <div>{error.message}</div>;
	}

	return (
		<div>
			<button
				onClick={() => {
					router.invalidate();
				}}
			>
				retry
			</button>
			<ErrorComponent error={error} />
		</div>
	);
}

function PostComponent() {
	const postId = Route.useParams().postId;
	const { data: post } = useSuspenseQuery(postQueryOptions(postId));

	return (
		<div className="space-y-2">
			<h4 className="font-bold text-xl underline">{post.title}</h4>
			<div className="text-sm">{post.body}</div>
		</div>
	);
}
