// The line for a table whose type check the workspace could not answer twice (type_check: 'busy'). It is not a verdict on the table,
// so it is never shown as not usable; Try again lists the table's schema again. Shared by the Data Filters tree and the Launch picker.
export default function TypeCheckBusyTryAgain({ name, onTryAgain }) {
  return (
    <>
      <span>{name}: Inspire could not check this table's type right now.</span>
      <button type="button" onClick={onTryAgain} className="underline">Try again</button>
    </>
  );
}
