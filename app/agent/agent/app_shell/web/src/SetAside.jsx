import { Icon } from './icons.jsx';

// The notice for a page the App set aside: its use case needs building again, and the rest of the App still works.
export default function SetAside({ text }) {
  return (
    <section className="tile-err page-failure" role="status" data-set-aside="">
      <p><Icon name="info" size={14} />{text}</p>
    </section>
  );
}
