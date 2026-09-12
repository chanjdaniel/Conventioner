export const getFormattedDate = (dateString: string) => {
  if (dateString === '') {
    return null;
  } else {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    // A market date is a calendar day ("YYYY-MM-DD"), not an instant: the
    // market happens on that day where the market is, so every viewer on
    // earth must see the same day. Format it with pure UTC math and never
    // convert it through a timezone. (The previous implementation pinned the
    // string to a hardcoded -08:00 offset and rendered it in the viewer's
    // local timezone, which showed the previous day to anyone west of UTC-8.)
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return days[date.getUTCDay()] + ', ' + months[date.getUTCMonth()] + ' ' + date.getUTCDate();
  }
};
