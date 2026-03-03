import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { postsQueryOptions } from "../../postsQueryOptions";

export const Route = createFileRoute("/posts")({
	component: PostsLayoutComponent,
	loader: ({ context: { queryClient } }) =>
		queryClient.ensureQueryData(postsQueryOptions),
});

function PostsLayoutComponent() {
	const postsQuery = useSuspenseQuery(postsQueryOptions);
	const posts = postsQuery.data;

	return (
		<div className="flex gap-2 p-2">
			<ul className="list-disc pl-4">
				{[...posts, { id: "i-do-not-exist", title: "Non-existent Post" }].map(
					(post) => {
						return (
							<li className="whitespace-nowrap" key={post.id}>
								<Link
									activeProps={{ className: "font-bold underline" }}
									className="block py-1 text-blue-600 hover:opacity-75"
									params={{
										postId: post.id,
									}}
									to="/posts/$postId"
								>
									<div>{post.title.substring(0, 20)}</div>
								</Link>
							</li>
						);
					},
				)}
			</ul>
			<hr />
			<Outlet />
		</div>
	);
}
