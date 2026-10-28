import { goto } from '$app/navigation';
import { editHref, meetingId, pageHref, todaysMeeting } from './wiki.svelte';

class Ui {
	newPageOpen = $state(false);
	newPageNs = $state('');
	drawerOpen = $state(false);

	newPage(ns = '') {
		this.newPageNs = ns;
		this.newPageOpen = true;
	}

	/** Open today's meeting if it exists, otherwise start a new one from the template. */
	meetingToday() {
		const today = todaysMeeting();
		if (today) return goto(editHref(today.id));
		return goto(editHref(meetingId(new Date()), '?template=verbale'));
	}

	newMeeting() {
		return goto(editHref(meetingId(new Date()), '?template=verbale'));
	}

	open(id: string) {
		return goto(pageHref(id));
	}
}

export const ui = new Ui();
