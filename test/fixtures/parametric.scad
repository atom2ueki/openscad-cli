// A bracket whose dimensions are meant to be overridden with -D.
// [Size]
width = 60;   // [20:1:120]
depth = 40;   // [10:1:80]
height = 12;  // [4:1:40]
wall = 3;     // [1:0.5:8]
label = "OPENSCAD-CLI";

module bracket() {
    difference() {
        cube([width, depth, height], center = true);
        // Hollow it out, leaving walls on all sides.
        translate([0, 0, -1])
            cube([width - 2 * wall, depth - 2 * wall, height], center = true);
        // Two mounting holes through the base.
        for (x = [-1, 1])
            translate([x * (width / 2 - wall * 2), 0, 0])
                cylinder(h = height * 2, r = wall, center = true, $fn = 24);
    }
}

bracket();
echo(str("label=", label, " w=", width, " d=", depth, " h=", height));
