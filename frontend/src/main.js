import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

// Svelte 5: components are functions mounted with mount(), not classes
// instantiated with `new`.
const app = mount(App, {
  target: document.getElementById('app'),
});

export default app;
