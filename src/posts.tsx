export type PostType = {
	id: string;
	title: string;
	body: string;
};

export class PostNotFoundError extends Error {}

export const fetchPost = async (postId: string) => {
	console.info(`Fetching post with id ${postId}...`);
	await new Promise((r) => setTimeout(r, 500));
	const post = await fetch(
		`https://jsonplaceholder.typicode.com/posts/${postId}`,
	)
		.then((r) => r.json() as Promise<PostType>)
		.catch((err) => {
			if (err.status === 404) {
				throw new PostNotFoundError(`Post with id "${postId}" not found!`);
			}
			throw err;
		});

	return post;
};

export const fetchPosts = async () => {
	console.info("Fetching posts...");
	await new Promise((r) => setTimeout(r, 500));
	return fetch("https://jsonplaceholder.typicode.com/posts")
		.then((r) => r.json() as Promise<Array<PostType>>)
		.then((r) => r.slice(0, 10));
};
