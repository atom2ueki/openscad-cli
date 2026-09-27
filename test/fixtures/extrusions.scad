// Exercises the extrude family plus hull/minkowski, the parts of the language
// an agent is most likely to get subtly wrong.
module star(n = 5, r = 10) {
    polygon(concat(
        [for (i = [0 : 2 * n - 1])
            let (a = i * 180 / n, rr = (i % 2 == 0) ? r : r / 2)
            [rr * cos(a), rr * sin(a)]]
    ));
}

linear_extrude(height = 6, twist = 30, slices = 12) star();
