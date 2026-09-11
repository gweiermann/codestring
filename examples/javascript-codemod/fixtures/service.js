// Keeps its own formatting, comments and quote style.
import { helper } from './helper.js';

export async function loadProduct(id) {
	debugger;
	console.log(   'loading', id   );

	const response = await legacyFetch(`/api/product/${id}`);

	if (!response.ok) {
		console.log('failed', response.status);   // trailing comment stays put
		return null;
	}

	return helper(response);
}
