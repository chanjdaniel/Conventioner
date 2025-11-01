export const getFormattedDate = (dateString: string) => {
    if (dateString === "") {
        return null;
    } else {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const now = new Date(dateString + "T00:00:00.000-08:00");
        return days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate();
    }
}
