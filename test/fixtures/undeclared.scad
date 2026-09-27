// Uses a variable that is never defined: the engine warns and continues.
w = 5;
echo(str("w=", w, " h=", h));
cube([w, 2, 2]);
