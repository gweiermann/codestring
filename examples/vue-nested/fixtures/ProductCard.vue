<template>
	<article class="card" :class="{ active: isActive }">
		<h2><b>{{ product.name }}</b></h2>
		<p class="price">{{ product.price }}</p>
	</article>
</template>

<script>
import { logger } from '../logging.js';

export default {
	props: { product: Object },
	mounted() {
		console.log(   'card mounted', this.product.id   );
		debugger;
	},
};
</script>

<style scoped>
/* keep this comment and the tabs below */
.card {
	color:   red;
	padding: 8px;
}

.price { color: red }
</style>
